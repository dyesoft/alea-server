import { Player, Room } from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestDB, TEST_DB_NAME } from '../../testutils.mjs';
import { MongoDB } from './mongodb.mjs';

const HOST_PLAYER_ID = 'host';
const OWNER_PLAYER_ID = 'owner';

const HOST_PLAYER = new Player('Host');
HOST_PLAYER.playerID = HOST_PLAYER_ID;

const TEST_ROOM_CODE = 'TEST';

describe('MongoDB', () => {
    describe('constructor', () => {
        test('sets expected fields', () => {
            const mockDB = {};
            const mockSession = {};
            const mockClient = {
                url: '',
                db: jest.fn().mockReturnValue(mockDB),
                startSession: jest.fn().mockReturnValue(mockSession),
            };
            const mongodb = new MongoDB(mockClient, TEST_DB_NAME);
            expect(mongodb.client).toBe(mockClient);
            expect(mongodb.dbName).toEqual(TEST_DB_NAME);
            expect(mongodb.url).not.toBeNull();
            expect(mongodb.db).toBe(mockDB);
            expect(mongodb.session).toBe(mockSession);
            expect(mongodb.games).not.toBeNull();
            expect(mongodb.players).not.toBeNull();
            expect(mongodb.rooms).not.toBeNull();
            expect(mongodb.roomLinkRequests).not.toBeNull();
        });
    });

    describe('new', () => {
        let mongodb;

        afterEach(async () => {
            await mongodb.close();
        })

        test('DB name in config', async () => {
            const config = {
                db: {
                    name: TEST_DB_NAME,
                    url: global.__MONGO_URI__,
                },
            };
            mongodb = await MongoDB.new(config);
            expect(mongodb.dbName).toEqual(TEST_DB_NAME);
        });

        test('URL in config', async () => {
            const config = {
                db: {url: global.__MONGO_URI__},
            };
            mongodb = await MongoDB.new(config);
            expect(mongodb.client).not.toBeNull();
        });

        test('host and port in config', async () => {
            const strippedURL = global.__MONGO_URI__.replaceAll('mongodb://', '').replaceAll('/', '');
            const [host, port] = strippedURL.split(':');
            const config = {
                db: {
                    host: host,
                    port: port,
                },
            };
            mongodb = await MongoDB.new(config);
            expect(mongodb.client).not.toBeNull();
        });

        test('creates session, DB, and collections', async () => {
            const config = {
                db: {url: global.__MONGO_URI__},
            };
            mongodb = await MongoDB.new(config);
            expect(mongodb.session).not.toBeNull();
            expect(mongodb.db).not.toBeNull();
            expect(mongodb.games).not.toBeNull();
            expect(mongodb.players).not.toBeNull();
            expect(mongodb.rooms).not.toBeNull();
            expect(mongodb.roomLinkRequests).not.toBeNull();
        });

        test('additional custom collections', async () => {
            const config = {
                db: {url: global.__MONGO_URI__},
            };
            const mockCollection = {};
            const collections = {
                tests: jest.fn().mockReturnValue(mockCollection),
            };
            mongodb = await MongoDB.new(config, collections);
            expect(mongodb.games).not.toBeNull();
            expect(mongodb.players).not.toBeNull();
            expect(mongodb.rooms).not.toBeNull();
            expect(mongodb.roomLinkRequests).not.toBeNull();
            expect(mongodb.tests).toBe(mockCollection);
            expect(collections.tests).toHaveBeenCalledWith(mongodb.db);
        });

        test('override default collections', async () => {
            const config = {
                db: {url: global.__MONGO_URI__},
            };
            const mockCollection = {};
            const collections = {
                games: jest.fn().mockReturnValue(mockCollection),
            };
            mongodb = await MongoDB.new(config, collections);
            expect(mongodb.games).toBe(mockCollection);
            expect(mongodb.players).not.toBeNull();
            expect(mongodb.rooms).not.toBeNull();
            expect(mongodb.roomLinkRequests).not.toBeNull();
            expect(collections.games).toHaveBeenCalledWith(mongodb.db);
        });
    });

    describe('command', () => {
        test('runs ping command successfully', async () => {
            const config = {
                db: {url: global.__MONGO_URI__},
            };
            const mongodb = await MongoDB.new(config);
            await expect(async () => await mongodb.command({ping: 1})).resolves;
            await mongodb.close();
        });
    });

    describe('findNewHostPlayerID', () => {
        let db;

        beforeAll(async () => {
            db = await getTestDB();
        });

        beforeEach(async () => {
            await db.players.create(HOST_PLAYER);
        });

        afterEach(async () => {
            await db.players.truncate(true);
        });

        afterAll(async () => {
            await db.close();
        });

        test('selects owner if not all players found', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = ['player1', 'player2', HOST_PLAYER_ID];
            const newHostPlayerID = await db.findNewHostPlayerID(room);
            expect(newHostPlayerID).toEqual(OWNER_PLAYER_ID);
        });

        test('selects first active, non-spectating player if one exists', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            const expectedPlayer = new Player('Fred');
            expectedPlayer.currentRoomID = room.roomID;
            const otherPlayer = new Player('Barney', null, true);
            otherPlayer.currentRoomID = room.roomID;
            await db.players.create(expectedPlayer);
            await db.players.create(otherPlayer);

            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = [otherPlayer.playerID, expectedPlayer.playerID, HOST_PLAYER_ID];
            const newHostPlayerID = await db.findNewHostPlayerID(room);
            expect(newHostPlayerID).toEqual(expectedPlayer.playerID);
        });

        test('selects first active player if one exists', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            const expectedPlayer = new Player('Fred', null, true);
            expectedPlayer.currentRoomID = room.roomID;
            const otherPlayer = new Player('Barney', null, true);
            otherPlayer.currentRoomID = room.roomID;
            otherPlayer.active = false;
            await db.players.create(expectedPlayer);
            await db.players.create(otherPlayer);

            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = [otherPlayer.playerID, expectedPlayer.playerID, HOST_PLAYER_ID];
            const newHostPlayerID = await db.findNewHostPlayerID(room);
            expect(newHostPlayerID).toEqual(expectedPlayer.playerID);
        });

        test('selects owner if not already the host', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            const otherPlayer = new Player('Fred', null);
            otherPlayer.currentRoomID = room.roomID;
            otherPlayer.active = false;
            await db.players.create(otherPlayer);

            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = [otherPlayer.playerID, HOST_PLAYER_ID];
            const newHostPlayerID = await db.findNewHostPlayerID(room);
            expect(newHostPlayerID).toEqual(OWNER_PLAYER_ID);
        });

        test('selects owner if room is empty', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.hostPlayerID = HOST_PLAYER_ID;
            const newHostPlayerID = await db.findNewHostPlayerID(room);
            expect(newHostPlayerID).toEqual(OWNER_PLAYER_ID);
        });

        test('returns null if no suitable player found', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.hostPlayerID = OWNER_PLAYER_ID;
            room.playerIDs = [OWNER_PLAYER_ID];
            const newHostPlayerID = await db.findNewHostPlayerID(room);
            expect(newHostPlayerID).toBeNull();
        });
    });

    describe('removePlayerFromRoom', () => {
        let db;

        beforeAll(async () => {
            db = await getTestDB();
        });

        beforeEach(async () => {
            await db.players.create(HOST_PLAYER);
        });

        afterEach(async () => {
            await db.players.truncate(true);
            await db.rooms.truncate(true);
        });

        afterAll(async () => {
            await db.close();
        });

        test('uses current room of player if room ID not provided', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            const player = new Player('Fred', null);
            player.currentRoomID = room.roomID;
            await db.players.create(player);

            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = [player.playerID, HOST_PLAYER_ID];
            await db.rooms.create(room);

            const newHostPlayerID = await db.removePlayerFromRoom(player);
            expect(newHostPlayerID).toBeNull();
            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([HOST_PLAYER_ID]);
        });

        test('returns null if room not found', async () => {
            const newHostPlayerID = await db.removePlayerFromRoom(null, 'room');
            expect(newHostPlayerID).toBeNull();
        });

        test('removes player and returns null if player is not host', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            const player = new Player('Fred', null);
            await db.players.create(player);

            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = [player.playerID, HOST_PLAYER_ID];
            await db.rooms.create(room);

            const newHostPlayerID = await db.removePlayerFromRoom(player, room.roomID);
            expect(newHostPlayerID).toBeNull();
            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([HOST_PLAYER_ID]);
        });

        test('removes player and returns new host player ID if player is host', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.hostPlayerID = HOST_PLAYER_ID;
            room.playerIDs = [HOST_PLAYER_ID];
            await db.rooms.create(room);

            const newHostPlayerID = await db.removePlayerFromRoom(HOST_PLAYER, room.roomID);
            expect(newHostPlayerID).toEqual(OWNER_PLAYER_ID);
            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([]);
        });
    });
});
