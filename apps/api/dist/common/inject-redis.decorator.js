"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InjectRedis = exports.REDIS_TOKEN = void 0;
const common_1 = require("@nestjs/common");
exports.REDIS_TOKEN = 'REDIS_CLIENT';
const InjectRedis = () => (0, common_1.Inject)(exports.REDIS_TOKEN);
exports.InjectRedis = InjectRedis;
//# sourceMappingURL=inject-redis.decorator.js.map