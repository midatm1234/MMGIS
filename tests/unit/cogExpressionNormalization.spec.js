import { test, expect } from '@playwright/test';
import {
    normalizeCogExpression,
    buildTiTilerQueryParams,
} from '../../src/essence/Basics/Layers_/LayerUtils.js';

/**
 * Band naming in COG expressions.
 *
 * rio-tiler >= 9 exposes the merged asset bands as `b1..bN`. MMGIS used to
 * rewrite `bN` into `asset_bN`, which that version rejects outright — TiTiler
 * answers 400 `Invalid band/asset name` and the layer renders as nothing. The
 * normalization has to go the other way now, while still accepting the old
 * spelling that is saved in existing mission configs.
 */
test.describe('normalizeCogExpression', () => {
    test('strips the legacy asset_ prefix', () => {
        expect(normalizeCogExpression('(asset_b1*100)')).toBe('(b1*100)');
        expect(normalizeCogExpression('asset_b1 + asset_b2')).toBe('b1 + b2');
        expect(normalizeCogExpression('asset_B1*2')).toBe('B1*2');
    });

    test('leaves already-correct band names alone', () => {
        expect(normalizeCogExpression('(b1*100)')).toBe('(b1*100)');
        expect(normalizeCogExpression('b1;b2;b3')).toBe('b1;b2;b3');
    });

    test('does not invent bands where there are none', () => {
        expect(normalizeCogExpression('')).toBe('');
        expect(normalizeCogExpression(null)).toBe(null);
        expect(normalizeCogExpression(undefined)).toBe(undefined);
    });

    test('leaves other asset names untouched', () => {
        // Only the literal `asset` prefix is MMGIS's own; anything else is the
        // author's and must survive verbatim.
        expect(normalizeCogExpression('red_b1 + nir_b1')).toBe('red_b1 + nir_b1');
    });

    test('is idempotent', () => {
        const once = normalizeCogExpression('(asset_b1*100)');
        expect(normalizeCogExpression(once)).toBe(once);
    });
});

test.describe('buildTiTilerQueryParams expression handling', () => {
    test('emits a bare bN expression for a legacy config', () => {
        const params = buildTiTilerQueryParams({
            splitColonType: 'stac-collection',
            starttime: '2023-06-15T00:00:00Z',
            endtime: '2023-06-15T23:59:59Z',
            cogTransform: true,
            cogMin: 0,
            cogMax: 100,
            cogColormap: 'cmrmap',
            cogExpression: '(asset_b1*100)',
        });

        expect(params).toContain(`expression=${encodeURIComponent('(b1*100)')}`);
        expect(params).not.toContain('asset_b1');
    });

    test('a runtime expression overrides the configured one', () => {
        const params = buildTiTilerQueryParams({
            splitColonType: 'stac-collection',
            endtime: '2023-06-15T23:59:59Z',
            cogExpression: '(asset_b1*100)',
            currentCogExpression: '(asset_b1*2)',
        });

        expect(params).toContain(`expression=${encodeURIComponent('(b1*2)')}`);
    });
});
