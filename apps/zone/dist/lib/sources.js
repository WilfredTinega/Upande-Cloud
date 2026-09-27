"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceByRegistry = exports.sourceById = exports.mirrorOf = exports.DEFAULT_SOURCE = exports.IMAGE_SOURCES = void 0;
exports.IMAGE_SOURCES = [
    { id: 'upande', label: 'Upande Cloud', registry: 'ghcr.io/wilfredtinega/upande-cloud' },
    { id: 'zonal', label: 'Zonal Cloud', registry: 'ghcr.io/zonaltech/zonal-cloud' },
];
exports.DEFAULT_SOURCE = exports.IMAGE_SOURCES[0];
const mirrorOf = (registry) => `${registry}/mirror`;
exports.mirrorOf = mirrorOf;
const sourceById = (id) => exports.IMAGE_SOURCES.find((s) => s.id === id.toLowerCase());
exports.sourceById = sourceById;
const sourceByRegistry = (registry) => registry ? exports.IMAGE_SOURCES.find((s) => s.registry === registry) : undefined;
exports.sourceByRegistry = sourceByRegistry;
