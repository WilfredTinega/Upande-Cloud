"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UptimeModule = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const uptime_service_1 = require("./uptime.service");
const uptime_processor_1 = require("./uptime.processor");
const uptime_controller_1 = require("./uptime.controller");
const uptime_constants_1 = require("./uptime.constants");
const auth_module_1 = require("../auth/auth.module");
let UptimeModule = class UptimeModule {
};
exports.UptimeModule = UptimeModule;
exports.UptimeModule = UptimeModule = __decorate([
    (0, common_1.Module)({
        imports: [bullmq_1.BullModule.registerQueue({ name: uptime_constants_1.UPTIME_QUEUE }), auth_module_1.AuthModule],
        controllers: [uptime_controller_1.AppUptimeController, uptime_controller_1.AdminUptimeController],
        providers: [uptime_service_1.UptimeService, uptime_processor_1.UptimeProcessor],
        exports: [uptime_service_1.UptimeService],
    })
], UptimeModule);
//# sourceMappingURL=uptime.module.js.map