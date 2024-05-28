import fs from "fs";
import path from "path";
import imagemin from "imagemin";
import imageminWebp from "imagemin-webp";

const args = process.argv.slice(2);
const outputFolder = args[0];

const getDirSize = (dirPath: string): number => {
	let size = 0;
	const files = fs.readdirSync(dirPath);

	for (const file of files) {
		const filePath = path.join(dirPath, file);
		const stats = fs.statSync(filePath);

		if (stats.isFile()) {
			size += stats.size;
		} else if (stats.isDirectory()) {
			size += getDirSize(filePath);
		}
	}

	return size;
};

const convertBytesToMegaBytes = (bytes: number): number => {
	return bytes / 1024 / 1024;
};

const convertToWebP = async () => {
	const source = `./${outputFolder}/png`;
	const destination = `./${outputFolder}/webp`;
	const numberOfPNGFiles = fs.readdirSync(source).length;

	fs.rmSync(destination, {recursive: true, force: true});

	await imagemin([`${source}/*.png`], {
		destination: destination,
		plugins: [
			imageminWebp({
				lossless: true,
			}),
		],
	});

	const numberOfWEBPFiles = fs.readdirSync(destination).length;

	if (numberOfPNGFiles !== numberOfWEBPFiles) {
		throw "Something went wrong, number of WebP files are not the same as number of PNG files...";
	}

	const pngDirSize = convertBytesToMegaBytes(getDirSize(source));
	const webpDirSize = convertBytesToMegaBytes(getDirSize(destination));

	console.log(`Converted ${numberOfPNGFiles} PNG files to WEBP format.`);
	console.log(
		`The original size of all the PNG files together was ${pngDirSize.toFixed(2)} MB, the size of the WEBP files together is ${webpDirSize.toFixed(2)} MB`,
	);
	console.log(`Which means the new size is ${((webpDirSize / pngDirSize) * 100).toFixed(2)}% of the original size.`);
};

convertToWebP();
