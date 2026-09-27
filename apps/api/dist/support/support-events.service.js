"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportEventsService = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const HEARTBEAT_MS = 25_000;
let SupportEventsService = class SupportEventsService {
    constructor() {
        this.events$ = new rxjs_1.Subject();
    }
    publish(event) {
        this.events$.next(event);
    }
    userStream(organizationId) {
        return (0, rxjs_1.merge)(this.events$.pipe((0, rxjs_1.filter)((e) => e.organizationId === organizationId), (0, rxjs_1.map)((e) => ({ data: { kind: e.kind, conversationId: e.conversationId, ...e.forUser } }))), this.heartbeat());
    }
    adminStream() {
        return (0, rxjs_1.merge)(this.events$.pipe((0, rxjs_1.map)((e) => ({ data: { kind: e.kind, conversationId: e.conversationId, ...e.forAdmin } }))), this.heartbeat());
    }
    heartbeat() {
        return (0, rxjs_1.interval)(HEARTBEAT_MS).pipe((0, rxjs_1.map)(() => ({ data: { kind: 'ping' } })));
    }
    onModuleDestroy() {
        this.events$.complete();
    }
};
exports.SupportEventsService = SupportEventsService;
exports.SupportEventsService = SupportEventsService = __decorate([
    (0, common_1.Injectable)()
], SupportEventsService);
//# sourceMappingURL=support-events.service.js.map