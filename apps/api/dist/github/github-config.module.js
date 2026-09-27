"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GithubConfigModule = void 0;
const common_1 = require("@nestjs/common");
const github_config_service_1 = require("./github-config.service");
let GithubConfigModule = class GithubConfigModule {
};
exports.GithubConfigModule = GithubConfigModule;
exports.GithubConfigModule = GithubConfigModule = __decorate([
    (0, common_1.Module)({
        providers: [github_config_service_1.GithubConfigService],
        exports: [github_config_service_1.GithubConfigService],
    })
], GithubConfigModule);
//# sourceMappingURL=github-config.module.js.map