//
// This file is used offline to create one single tile from provided PDF with proper parameters
// We can start multiple instances of this file. With this, we can achieve multi-threading, (yes, even in the node.js environment)
//

import type {Canvas} from "canvas";
import type {PointDouble} from "../../generated/api/base";
import {ImageUtils} from "../../utils/image/ImageUtils";
import {THREEUtils} from "../../utils/THREEUtils";
import {FileUtils} from "../utils/FileUtils";
import {PDFRenderer} from "../utils/PDFRenderer";

const args = process.argv.slice(2);

const pdfFileName = args[0];
const desiredTileResolution = Number(args[1]);
const spaceSize: PointDouble = {
	x: Number(args[2]),
	y: Number(args[3]),
};
const spaceResolution: PointDouble = {
	x: Number(args[4]),
	y: Number(args[5]),
};

const z: number = Number(args[6]);
const x: number = Number(args[7]);
const y: number = Number(args[8]);

const pdfFileNameWithoutExtension = pdfFileName.substring(0, pdfFileName.lastIndexOf("."));
const outputFolder = `output/${pdfFileNameWithoutExtension}/png`;

const tileId = `${z}_${x}_${y}`;
const outputFileName = `${tileId}.png`;
const zoomInfoObject = THREEUtils.generateZoomInfo(spaceSize, spaceResolution, desiredTileResolution, false);
const pdfRenderer = new PDFRenderer(desiredTileResolution);

const rasterizePDF = async () => {
	await pdfRenderer.init(pdfFileName, spaceSize.x);

	const zoomInfo = zoomInfoObject[z];
	const {context} = await pdfRenderer.getSnapShot(tileId, zoomInfo, desiredTileResolution);
	const ctx = context as unknown as CanvasRenderingContext2D;

	if (!ImageUtils.isCanvasCompletelyWhite(ctx)) {
		await FileUtils.writeFile(`${outputFolder}/${outputFileName}`, (ctx.canvas as unknown as Canvas).toBuffer("image/png"));
	}
};

const doStuff = async () => {
	await rasterizePDF();
};

doStuff();
