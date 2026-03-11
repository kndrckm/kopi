"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stickerify = void 0;
const canvas_1 = require("canvas");
const trim_1 = __importDefault(require("./trim"));
function stickerify(img, thickness = 1, fillStyle = 'white', samples = 36) {
    const x = thickness + 1, // 1px buffer in case of rounding errors etc.
    y = thickness + 1;
    const canvas = (0, canvas_1.createCanvas)(img.width + x * 2, img.height + y * 2), ctx = canvas.getContext('2d');
    for (let angle = 0; angle < 360; angle += 360 / samples) {
        ctx.drawImage(img, thickness * Math.sin((Math.PI * 2 * angle) / 360) + x, thickness * Math.cos((Math.PI * 2 * angle) / 360) + y);
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(img, x, y);
    return (0, trim_1.default)(canvas);
}
exports.stickerify = stickerify;
