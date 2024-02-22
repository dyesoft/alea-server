import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { Player } from '@dyesoft/alea-core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { MONGO_CLIENT_OPTIONS } from './constants.mjs';
import PlayerCollection from './player.mjs';

const TEST_PLAYERS = [
    {...new Player('Barney', 'barney@example.com'), active: true},
    {...new Player('Betty', 'b3tty@example.com'), active: true},
    {...new Player('Fred', 'fred@example.com'), active: false},
    {...new Player('Wilma', 'wilma@example.com'), active: false},
];

describe('PlayerCollection', () => {
    let conn;
    let db;
    let collection;

    beforeAll(async () => {
        conn = await MongoClient.connect(global.__MONGO_URI__, MONGO_CLIENT_OPTIONS);
        db = await conn.db();
    });

    beforeEach(async () => {
        collection = new PlayerCollection(db);
        await collection.collection.deleteMany({});
    });

    afterAll(async () => {
        await conn.close();
    });

    describe('count', () => {
        test('no filters', async () => {
            await collection.collection.insertMany(TEST_PLAYERS);
            const count = await collection.count();
            expect(count).toEqual(TEST_PLAYERS.length);
        });

        test('active players only', async () => {
            await collection.collection.insertMany(TEST_PLAYERS);
            const count = await collection.count(true);
            expect(count).toEqual(2);
        });
    });

    describe('getPageOfPlayers', () => {
        test('no filters', async () => {
            await collection.collection.insertMany(TEST_PLAYERS);
            const page = await collection.getPageOfPlayers(1);
            expect(page).toHaveLength(TEST_PLAYERS.length);
        });

        test('active players only', async () => {
            await collection.collection.insertMany(TEST_PLAYERS);
            const page = await collection.getPageOfPlayers(1, true);
            expect(page).toHaveLength(2);
            page.forEach(player => expect(player.active).toBe(true));
        });
    });

    describe('getByEmail', () => {
        test('returns player with matching email', async () => {
            const name = 'Fred';
            const email = 'test@example.com';
            await collection.create(new Player(name, email));
            const player = await collection.getByEmail(email);
            expect(player.name).toEqual(name);
            expect(player.email).toEqual(email);
        });
    });

    describe('updateNameAndEmailByID', () => {
        test('updates name and email of player with matching ID', async () => {
            const name = 'Fred';
            const email = 'test@example.com';
            const player = new Player('Freddie', 'old@example.com');
            await collection.create(player);
            await collection.updateNameAndEmailByID(player.playerID, name, email);
            const newPlayer = await collection.getByID(player.playerID);
            expect(newPlayer).toEqual({
                ...player,
                name: name,
                email: email,
            });
        });
    });
});
