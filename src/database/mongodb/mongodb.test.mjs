import { describe, expect, test } from '@jest/globals';
import { MongoDB } from './mongodb.mjs';

const TEST_DB_NAME = 'test-db';

describe('MongoDB', () => {
    describe('constructor', () => {
        const TEST_DB_HOST = 'localhost';
        const TEST_DB_PORT = 12345;
        const TEST_DB_URL = `mongodb://${TEST_DB_HOST}:${TEST_DB_PORT}/`;

        test('sets expected fields', () => {
            const config = {
                db: {url: TEST_DB_URL},
            };
            const mongodb = new MongoDB(config, TEST_DB_NAME);
            expect(mongodb.dbName).toEqual(TEST_DB_NAME);
            expect(mongodb.client).toBeDefined();
            expect(mongodb.session).toBeNull();
            expect(mongodb.db).toBeNull();
            expect(mongodb.games).toBeNull();
            expect(mongodb.players).toBeNull();
            expect(mongodb.rooms).toBeNull();
            expect(mongodb.roomLinkRequests).toBeNull();
        });

        test('URL in config', () => {
            const config = {
                db: {url: TEST_DB_URL},
            };
            const mongodb = new MongoDB(config, TEST_DB_NAME);
            expect(mongodb.url).toEqual(TEST_DB_URL);
        });

        test('host and port in config', () => {
            const config = {
                db: {host: TEST_DB_HOST, port: TEST_DB_PORT},
            };
            const mongodb = new MongoDB(config, TEST_DB_NAME);
            expect(mongodb.url).toEqual(TEST_DB_URL);
        });
    });

    describe('init', () => {
        test('creates session, DB, and collections', async () => {
            const config = {
                db: {url: global.__MONGO_URI__},
            };
            const mongodb = new MongoDB(config, TEST_DB_NAME);
            await mongodb.init();
            expect(mongodb.session).not.toBeNull();
            expect(mongodb.db).not.toBeNull();
            expect(mongodb.games).not.toBeNull();
            expect(mongodb.players).not.toBeNull();
            expect(mongodb.rooms).not.toBeNull();
            expect(mongodb.roomLinkRequests).not.toBeNull();
            await mongodb.client.close();
        });
    });
});
