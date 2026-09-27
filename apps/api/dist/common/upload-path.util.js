"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadRoot = uploadRoot;
exports.appUploadDir = appUploadDir;
const path = require("path");
function uploadRoot() {
    return process.env.UPLOAD_ROOT ?? '/tmp/upande-uploads';
}
function appUploadDir(appId) {
    return path.join(uploadRoot(), appId);
}
//# sourceMappingURL=upload-path.util.js.map