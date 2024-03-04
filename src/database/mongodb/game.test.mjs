import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { MONGO_CLIENT_OPTIONS } from './constants.mjs';
import GameCollection from './game.mjs';

describe('GameCollection', () => {
    let conn;
    let db;
    let collection;

    beforeAll(async () => {
        conn = await MongoClient.connect(global.__MONGO_URI__, MONGO_CLIENT_OPTIONS);
        db = await conn.db();
    });

    beforeEach(async () => {
        collection = new GameCollection(db);
        await collection.collection.deleteMany({});
    });

    afterAll(async () => {
        await conn.close();
    });

    describe('addPlayerToGame', () => {
        test('updates expected fields', async () => {
            const gameID = 'game';
            const playerID = 'player';
            await collection.create({gameID: gameID, playerIDs: [], scores: {}});
            await collection.addPlayerToGame(gameID, playerID);
            const game = await collection.getByID(gameID);
            expect(game.playerIDs).toEqual([playerID]);
            expect(game.scores).toEqual({[playerID]: 0});
        });
    });
});
