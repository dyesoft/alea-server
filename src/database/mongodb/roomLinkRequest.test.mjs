import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { RoomLinkRequest, RoomLinkRequestResolution } from '@dyesoft/alea-core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { MONGO_CLIENT_OPTIONS } from './constants.mjs';
import RoomLinkRequestCollection from './roomLinkRequest.mjs';

const TEST_REQUESTS = [
    {...new RoomLinkRequest('Barney', 'barney@example.com'), resolution: RoomLinkRequestResolution.UNRESOLVED},
    {...new RoomLinkRequest('Betty', 'b3tty@example.com'), resolution: RoomLinkRequestResolution.REJECTED},
    {...new RoomLinkRequest('Fred', 'fred@example.com'), resolution: RoomLinkRequestResolution.APPROVED},
    {...new RoomLinkRequest('Wilma', 'wilma@example.com'), resolution: RoomLinkRequestResolution.APPROVED},
];

describe('RoomLinkRequestCollection', () => {
    let conn;
    let db;
    let collection;

    beforeAll(async () => {
        conn = await MongoClient.connect(global.__MONGO_URI__, MONGO_CLIENT_OPTIONS);
        db = await conn.db();
    });

    beforeEach(async () => {
        collection = new RoomLinkRequestCollection(db);
        await collection.collection.deleteMany({});
    });

    afterAll(async () => {
        await conn.close();
    });

    describe('count', () => {
        test('no filters', async () => {
            await collection.collection.insertMany(TEST_REQUESTS);
            const count = await collection.count();
            expect(count).toEqual(TEST_REQUESTS.length);
        });

        test('approved requests only', async () => {
            await collection.collection.insertMany(TEST_REQUESTS);
            const count = await collection.count(RoomLinkRequestResolution.APPROVED);
            expect(count).toEqual(2);
        });
    });

    describe('getPageOfRoomLinkRequests', () => {
        test('no filters', async () => {
            await collection.collection.insertMany(TEST_REQUESTS);
            const page = await collection.getPageOfRoomLinkRequests(1);
            expect(page).toHaveLength(TEST_REQUESTS.length);
        });

        test('approved requests only', async () => {
            const resolution = RoomLinkRequestResolution.APPROVED;
            await collection.collection.insertMany(TEST_REQUESTS);
            const page = await collection.getPageOfRoomLinkRequests(1, resolution);
            expect(page).toHaveLength(2);
            page.forEach(player => expect(player.resolution).toEqual(resolution));
        });
    });

    describe('getByEmail', () => {
        test('returns request with matching email', async () => {
            const name = 'Fred';
            const email = 'test@example.com';
            await collection.create(new RoomLinkRequest(name, email));
            const request = await collection.getByEmail(email);
            expect(request.name).toEqual(name);
            expect(request.email).toEqual(email);
        });
    });

    describe('resolveByID', () => {
        test('updates resolution and resolved time of request with matching ID', async () => {
            const resolution = RoomLinkRequestResolution.REJECTED;
            const resolvedTime = new Date();
            const expectedRequest = new RoomLinkRequest('Fred', 'fred@example.com');
            await collection.create(expectedRequest);
            let request = await collection.getByID(expectedRequest.requestID);
            expect(request.resolution).toEqual(RoomLinkRequestResolution.UNRESOLVED);
            expect(request.resolvedTime).toBeNull();
            await collection.resolveByID(expectedRequest.requestID, resolution, resolvedTime);
            request = await collection.getByID(expectedRequest.requestID);
            expect(request.resolution).toEqual(resolution);
            expect(request.resolvedTime).toEqual(resolvedTime);
        });
    });

    describe('setRoomByID', () => {
        test('updates room ID and room code of request with matching ID', async () => {
            const roomID = 'room';
            const roomCode = 'TEST';
            const expectedRequest = new RoomLinkRequest('Fred', 'fred@example.com');
            await collection.create(expectedRequest);
            let request = await collection.getByID(expectedRequest.requestID);
            expect(request.roomID).toBeNull();
            expect(request.roomCode).toBeNull();
            await collection.setRoomByID(expectedRequest.requestID, roomID, roomCode);
            request = await collection.getByID(expectedRequest.requestID);
            expect(request.roomID).toEqual(roomID);
            expect(request.roomCode).toEqual(roomCode);
        });
    });
});
