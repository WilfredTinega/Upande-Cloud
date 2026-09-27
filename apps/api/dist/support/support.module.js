"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportModule = void 0;
const common_1 = require("@nestjs/common");
const support_controller_1 = require("./support.controller");
const admin_support_controller_1 = require("./admin-support.controller");
const support_service_1 = require("./support.service");
const support_events_service_1 = require("./support-events.service");
const audit_service_1 = require("../common/audit.service");
let SupportModule = class SupportModule {
};
exports.SupportModule = SupportModule;
exports.SupportModule = SupportModule = __decorate([
    (0, common_1.Module)({
        controllers: [support_controller_1.SupportController, admin_support_controller_1.AdminSupportController],
        providers: [support_service_1.SupportService, support_events_service_1.SupportEventsService, audit_service_1.AuditService],
    })
], SupportModule);
//# sourceMappingURL=support.module.js.map