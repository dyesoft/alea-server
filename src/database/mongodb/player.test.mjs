import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { Player, PlayerStatsKeys } from '@dyesoft/alea-core';
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
        await collection.truncate(true);
    });

    afterAll(async () => {
        await conn.close();
    });

    describe('count', () => {
        test('no filters', async () => {
            await collection.createMany(TEST_PLAYERS);
            const count = await collection.count();
            expect(count).toEqual(TEST_PLAYERS.length);
        });

        test('active players only', async () => {
            await collection.createMany(TEST_PLAYERS);
            const count = await collection.count(true);
            expect(count).toEqual(2);
        });
    });

    describe('getPageOfPlayers', () => {
        test('no filters', async () => {
            await collection.createMany(TEST_PLAYERS);
            const page = await collection.getPageOfPlayers(1);
            expect(page).toHaveLength(TEST_PLAYERS.length);
        });

        test('active players only', async () => {
            await collection.createMany(TEST_PLAYERS);
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

    describe('incrementStat', () => {
        const stat = PlayerStatsKeys.GAMES_PLAYED;

        test('increments stat by specified amount', async () => {
            const value = 5;
            const player = new Player('Fred');
            player.stats[stat] = value;
            await collection.create(player);
            await collection.incrementStat(player.playerID, stat, value);
            const newPlayer = await collection.getByID(player.playerID);
            expect(newPlayer.stats[stat]).toEqual(value * 2);
        });

        test('increments stat by one if no amount provided', async () => {
            const player = new Player('Fred');
            await collection.create(player);
            await collection.incrementStat(player.playerID, stat);
            const newPlayer = await collection.getByID(player.playerID);
            expect(newPlayer.stats[stat]).toEqual(1);
        });
    });

    describe('setStat', () => {
        const stat = PlayerStatsKeys.HIGHEST_GAME_SCORE;

        test('sets stat to specified value', async () => {
            const value = 10_000;
            const player = new Player('Fred');
            await collection.create(player);
            await collection.setStat(player.playerID, stat, value);
            const newPlayer = await collection.getByID(player.playerID);
            expect(newPlayer.stats[stat]).toEqual(value);
        });
    });
});
