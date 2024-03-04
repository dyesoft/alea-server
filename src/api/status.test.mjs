import { StatusCodes } from '@dyesoft/alea-core';
import { describe, expect, jest, test } from '@jest/globals';
import StatusAPI from './status.mjs';
import { app } from './testutils.mjs';

describe('StatusAPI', () => {
    describe('constructor', () => {
        const db = {};
        const version = '1.2.3';
        const api = new StatusAPI(db, version);

        test('with DB and package version', () => {
            expect(api.db).toBe(db);
            expect(api.packageVersion).toEqual(version);
        });

        test('creates routes for GET /health and GET /version', () => {
            expect(api._router.stack).toHaveLength(2);

            const healthRoute = api._router.stack[0].route;
            expect(healthRoute.path).toEqual('/health');
            expect(healthRoute.methods).toEqual({get: true});

            const versionRoute = api._router.stack[1].route;
            expect(versionRoute.path).toEqual('/version');
            expect(versionRoute.methods).toEqual({get: true});
        });
    });

    describe('handleGetHealth', () => {
        test('successful ping', async () => {
            const mockCommand = jest.fn().mockResolvedValue(null);
            const api = new StatusAPI({command: mockCommand}, '1.2.3');
            const response = await app(api).get('/health');
            expect(response.status).toEqual(StatusCodes.NO_CONTENT);
        });

        test('error', async () => {
            const mockCommand = jest.fn().mockRejectedValue(new Error());
            const api = new StatusAPI({command: mockCommand}, '1.2.3');
            const response = await app(api).get('/health');
            expect(response.status).toEqual(StatusCodes.SERVICE_UNAVAILABLE);
            expect(response.body.error).toEqual('Health check failed');
        });
    });

    describe('handleGetVersion', () => {
        test('returns package version', async () => {
            const version = '1.2.3';
            const api = new StatusAPI(null, version);
            const response = await app(api).get('/version');
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual({version: version});
        });
    });
});
