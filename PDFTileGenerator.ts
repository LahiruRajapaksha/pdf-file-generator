import os from "os";
import {DebugInformation} from "../../utils/DebugInformation";
import {Constants} from "../../ui/modules/space/spaceeditor/logic3d/Constants";
import type {DistanceUnitName} from "../../ui/modules/space/spaceeditor/logic3d/Constants";
import {THREEUtils} from "../../utils/THREEUtils";
import type {PointDouble, SpaceFileInsertionInfo} from "../../generated/api/base";
import {calculateSpaceResolution, SpaceEditorMode} from "../../ui/modules/space/spaceeditor/logic3d/renderers/SpaceViewRendererUtils";
import type {IRealSize} from "../../ui/modules/settings/modules/type/form/RealSizeInput";
import {FileUtils} from "../utils/FileUtils";
import {Exec} from "../utils/Exec";

/*
Measurements:
For the whole process: 257 tiles

Naive solution with one-tile at a time (creating the tiles one by one)
- (Linux subsystem on top of Windows 10)
- i5 7600K (4 cores):      928 603 ms, ~ 15 min,  3.6 sec / tile on average
- Apple m1 pro (10 cores): 875 951 ms, ~14.5 min, 3.4 sec / tile on average

Promise-based "multithreading":

- Apple m1 pro (10 cores,  4 threads): 243 254 ms, ~4 min, 0.95 sec / tile on average
- Apple m1 pro (10 cores, 10 threads): 115 281 ms, <2 min, 0.45 sec / tile on average
- Apple m1 pro (10 cores, 20 threads): 112 417 ms, <2 min, 0.44 sec / tile on average
- Apple m1 pro (10 cores, 10 threads, 1 thread / tile, Promise.race): 111 296 ms

- (Linux subsystem on top of Windows 10):
  - i5 7600K (4 cores, 4 threads, 4 threads / tile): 270 574 ms, ~4.5 min, 1 sec / tile on average
  - i5 7600K (4 cores, 4 threads, 1 thread / tile, Promise.all ): 261 316 ms
  - i5 7600K (4 cores, 4 threads, 1 thread / tile, Promise.race): 251 138 ms
  - ryzen 5 5600X (6 cores, 12 threads,  1 thread  / tile, Promise.race): 187 254 ms
  - ryzen 5 5600X (6 cores,  6 threads,  1 thread  / tile, Promise.race): 216 002 ms
  - ryzen 5 5600X (6 cores, 12 threads, 12 threads / tile, Promise.race): 182 185 ms

- Windows 10:
  - i5 7600K (4 cores, 4 threads, 1 thread / tile, Promise.race): 480 370 ms

~53.6 MB of PNG images (257 files), so it's an average of ~206 kB / tile (2048x2048 px)


In San Marcos level1:
- 253 out of 657 tiles are completely empty... That's almost 40%


Ghostscript-generated PDFs have rough edges on the symbols, no antialiasing.
I've found this: https://bugs.ghostscript.com/show_bug.cgi?id=694413

So it seems, maybe we should use pdfjs on the server as well...

With pdfjs: The overall size of 404 non empty tiles is 110 MB. (With ghostscript it's 22 MB)

Whole process with pdfjs, single threaded: 803230 ms
(+ removeEmptyTiles: 37357 ms - it can be ommitted with pdfjs, because we already have the canvas context to check for empty tiles before saving)


*/

const desiredTileResolution = Constants.RESOLUTION.TILE;

const args = process.argv.slice(2);

// const pdfFileWithoutExtension = "Murrieta_Level1";
// const pdfFile = `${pdfFileWithoutExtension}.pdf`;
// const spaceFileInsertionInfo: SpaceFileInsertionInfo = {
// 	width : 109.45751329480044,
// 	height: 82.09313497110033,
// };
// const xyiconSize: IRealSize = {
// 	value: 10,
// 	unit : "inch",
// };
// const spaceUnitsPerMeter: number = 1.0172952244997242;

const pdfFile = args[0];
const pdfFileWithoutExtension = pdfFile.substring(0, pdfFile.lastIndexOf(".pdf"));
const spaceFileInsertionInfo: SpaceFileInsertionInfo = {
	width: parseFloat(args[1]),
	height: parseFloat(args[2]),
};
const xyiconSize: IRealSize = {
	value: parseFloat(args[3]),
	unit: args[4] as DistanceUnitName,
};
const spaceUnitsPerMeter: number = parseFloat(args[5]);

const validateParameters = (): boolean => {
	const numArray = [spaceFileInsertionInfo.width, spaceFileInsertionInfo.height, xyiconSize.value, spaceUnitsPerMeter];

	if (numArray.some((n) => isNaN(n))) {
		console.error("Some of the numeric parameters are not valid numbers.");

		return false;
	}

	const distanceUnitNames = Object.keys(Constants.DISTANCE_UNITS).filter((n) => n !== "foot&inch") as DistanceUnitName[];

	if (!distanceUnitNames.includes(xyiconSize.unit as DistanceUnitName)) {
		console.error(`${xyiconSize.unit} is not a valid unit name. Please choose from the following ones: ${distanceUnitNames.join(", ")}`);

		return false;
	}

	return true;
};
const areParamsValid = validateParameters();

if (!areParamsValid) {
	process.exit(1);
}

const {spaceResolution} = calculateSpaceResolution(spaceUnitsPerMeter, spaceFileInsertionInfo, xyiconSize, SpaceEditorMode.NORMAL);

console.log(`Space resolution: ${spaceResolution.x}px * ${spaceResolution.y}px`);

const platform = process.platform;

console.log(platform);

const spaceSize: PointDouble = {
	x: spaceFileInsertionInfo.width,
	y: spaceFileInsertionInfo.height,
};
const zoomInfoObject = THREEUtils.generateZoomInfo(spaceSize, spaceResolution, desiredTileResolution, false);

const cpus = os.cpus();

console.log(`CPU: ${cpus[0]?.model}`);
const threads = cpus.length || 4;

console.log(`Working with ${threads} threads`);

const outputFolderBase = `output/${pdfFileWithoutExtension}`;
const outputFolder = `${outputFolderBase}/png`;

const getNumberOfAllTiles = () => {
	let sum = 0;

	for (const z of zoomInfoObject) {
		sum += z.columns * z.rows;
	}

	return sum;
};

const rasterizePDF = async () => {
	const doesFolderExist = FileUtils.doesFileOrDirectoryExist(outputFolder);

	if (doesFolderExist) {
		await FileUtils.removeFileOrDir(outputFolder);
	}
	FileUtils.makeDir(outputFolder);

	let promises: Promise<string>[] = [];

	const rasterizationDebugInfoName = "Whole process";

	DebugInformation.start(rasterizationDebugInfoName);

	let counter = 0;
	const allTiles = getNumberOfAllTiles();

	const logPercentage = () => {
		console.log(`Processing tiles... ${counter} / ${allTiles} tiles... ${Math.floor((100 * counter) / allTiles)}%`);
	};

	for (let z = 0; z < zoomInfoObject.length; ++z) {
		const zoomInfo = zoomInfoObject[z];

		for (let y = 0; y < zoomInfo.rows; ++y) {
			for (let x = 0; x < zoomInfo.columns; ++x) {
				const promisesLength = promises.length;

				if (promisesLength >= threads) {
					await Promise.all(promises);
					counter += promises.length;
					promises.length = 0;

					// await Promise.race(promises);
					// // This is a little bit hacky way to filter out pending promises...
					// // TODO: Not working anymore...?
					// promises = promises.filter(p => `${p}`.includes("pending"));

					// counter += promisesLength - promises.length;

					logPercentage();
				}

				const outputFileName = `${z}_${x}_${y}.png`;

				promises.push(
					Exec.execAsync(
						`node ../../../../build/offline/pdf_tile_creator/src/PDFTileCreator.js
							${pdfFile}
							${desiredTileResolution}
							${spaceSize.x}
							${spaceSize.y}
							${spaceResolution.x}
							${spaceResolution.y}
							${z}
							${x}
							${y}
						`
							.trim()
							.replace(/\s+/g, " "),
						outputFileName,
					),
				);
			}
		}
	}

	await Promise.all(promises);
	counter += promises.length;
	promises.length = 0;
	logPercentage();

	DebugInformation.end(rasterizationDebugInfoName);
};

const convertToWebp = async () => {
	console.log("Converting PNG files to WEBP...");
	const webpConversionLogId = "WebPConversion";
	const outputFromConverter = await Exec.execAsync(`npx ts-node --esm ./PNGtoWEBP.ts ${outputFolderBase}`, webpConversionLogId);

	console.log(outputFromConverter);
	console.log("Done!");
};

const doStuff = async () => {
	await rasterizePDF();
	await convertToWebp();
};

doStuff();
