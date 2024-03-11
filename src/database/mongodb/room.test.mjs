import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { Game, Player, Room, validateRoomCode } from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { MONGO_CLIENT_OPTIONS } from './constants.mjs';
import GameCollection from './game.mjs';
import PlayerCollection from './player.mjs';
import RoomCollection from './room.mjs';

const TEST_ROOM_CODE = 'TEST';

const OWNER_PLAYER_ID = 'owner';
const PLAYER_ID = 'player';

const GAME_ID = 'game';
const PREV_GAME_ID = 'prev-game';

describe('RoomCollection', () => {
    let conn;
    let db;
    let collection;
    let gameCollection;
    let playerCollection;

    beforeAll(async () => {
        conn = await MongoClient.connect(global.__MONGO_URI__, MONGO_CLIENT_OPTIONS);
        db = await conn.db();
    });

    beforeEach(() => {
        collection = new RoomCollection(db);
        gameCollection = new GameCollection(db);
        playerCollection = new PlayerCollection(db);
    });

    afterEach(async () => {
        await collection.truncate(true);
        await gameCollection.truncate(true);
        await playerCollection.truncate(true);
    });

    afterAll(async () => {
        await conn.close();
    });

    describe('generateUniqueRoomCode', () => {
        test('generates random code using allowed letters', async () => {
            const code = await collection.generateUniqueRoomCode();
            expect(validateRoomCode(code)).toBeTruthy();
        });

        test('regenerates code if room already exists', async () => {
            collection.getByRoomCode = jest.fn().mockResolvedValueOnce({roomID: 'room'}).mockResolvedValue(null);
            await collection.generateUniqueRoomCode();
            expect(collection.getByRoomCode).toHaveBeenCalledTimes(2);
        });
    });

    describe('create', () => {
        test('adds new room to collection', async () => {
            const newRoom = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            await collection.create(newRoom);
            expect(newRoom).toEqual({...newRoom, _id: newRoom.roomID});
            const room = await collection.getByID(newRoom.roomID);
            expect(room).toEqual(newRoom);
        });

        test('generates unique room code if missing', async () => {
            const newRoom = new Room(null, OWNER_PLAYER_ID);
            await collection.create(newRoom);
            expect(validateRoomCode(newRoom.roomCode)).toBeTruthy();
        });
    });

    describe('getRoomByCode', () => {
        test('returns room with matching code', async () => {
            await collection.create(new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID));
            const room = await collection.getByRoomCode(TEST_ROOM_CODE);
            expect(room.roomCode).toEqual(TEST_ROOM_CODE);
            expect(room.ownerPlayerID).toEqual(OWNER_PLAYER_ID);
        });
    });

    describe('setCurrentGameForRoom', () => {
        const CHAMPION_PLAYER_ID = 'player1';
        const PREV_CHAMPION_PLAYER_ID = 'player2';

        test('does nothing if game is already current', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.currentGameID = GAME_ID;
            await collection.create(room);

            const spy = jest.spyOn(collection, 'updateFieldsByID');
            await collection.setCurrentGameForRoom(room, GAME_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual(room);
            expect(spy).not.toHaveBeenCalled();
        });

        test('no current game (new room)', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            await collection.create(room);
            expect(room.currentGameID).toBeNull();

            await collection.setCurrentGameForRoom(room, GAME_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({...room, currentGameID: GAME_ID});
        });

        test('adds current game to previous games', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.currentGameID = PREV_GAME_ID;
            await collection.create(room);
            expect(room.previousGameIDs).toEqual([]);

            await collection.setCurrentGameForRoom(room, GAME_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({
                ...room,
                currentGameID: GAME_ID,
                previousGameIDs: [PREV_GAME_ID],
            });
        });

        test('increments winning streak if current champion remains the same', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.currentChampion = CHAMPION_PLAYER_ID;
            room.currentWinningStreak = 4;
            await collection.create(room);

            await collection.setCurrentGameForRoom(room, GAME_ID, CHAMPION_PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({
                ...room,
                currentGameID: GAME_ID,
                currentWinningStreak: 5,
            });
        });

        test('resets winning streak if current champion is different', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.currentChampion = PREV_CHAMPION_PLAYER_ID;
            room.currentWinningStreak = 7;
            await collection.create(room);

            await collection.setCurrentGameForRoom(room, GAME_ID, CHAMPION_PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({
                ...room,
                currentGameID: GAME_ID,
                currentChampion: CHAMPION_PLAYER_ID,
                currentWinningStreak: 1,
            });
        });

        test('sets winning streak to zero if no current champion (tie)', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.currentChampion = CHAMPION_PLAYER_ID;
            room.currentWinningStreak = 2;
            await collection.create(room);

            await collection.setCurrentGameForRoom(room, GAME_ID, null);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({
                ...room,
                currentGameID: GAME_ID,
                currentChampion: null,
                currentWinningStreak: 0,
            });
        });
    });

    describe('addPlayerToRoom', () => {
        test('adds player to players in room', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            await collection.create(room);
            expect(room.playerIDs).toEqual([OWNER_PLAYER_ID]);

            await collection.addPlayerToRoom(room.roomID, PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([OWNER_PLAYER_ID, PLAYER_ID]);
        });

        test('does not add duplicate entry if player already in room', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            await collection.create(room);
            expect(room.playerIDs).toEqual([OWNER_PLAYER_ID]);

            await collection.addPlayerToRoom(room.roomID, OWNER_PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([OWNER_PLAYER_ID]);
        });
    });

    describe('removePlayerFromRoom', () => {
        test('removes player from players in room', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.playerIDs.push(PLAYER_ID);
            await collection.create(room);
            expect(room.playerIDs).toEqual([OWNER_PLAYER_ID, PLAYER_ID]);

            await collection.removePlayerFromRoom(room.roomID, PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({...room, playerIDs: [OWNER_PLAYER_ID]});
        });

        test('reassigns host if new host provided', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.playerIDs.push(PLAYER_ID);
            room.hostPlayerID = OWNER_PLAYER_ID;
            await collection.create(room);
            expect(room.playerIDs).toEqual([OWNER_PLAYER_ID, PLAYER_ID]);

            await collection.removePlayerFromRoom(room.roomID, OWNER_PLAYER_ID, PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({
                ...room,
                playerIDs: [PLAYER_ID],
                hostPlayerID: PLAYER_ID,
            });
        });
    });

    describe('removePlayerFromKickedPlayersInRoom', () => {
        test('removes player from kicked players set', async () => {
            const room = new Room(TEST_ROOM_CODE, OWNER_PLAYER_ID);
            room.kickedPlayerIDs[PLAYER_ID] = new Date();
            await collection.create(room);

            await collection.removePlayerFromKickedPlayersInRoom(room.roomID, PLAYER_ID);
            const newRoom = await collection.getByID(room.roomID);
            expect(newRoom).toEqual({...room, kickedPlayerIDs: {}});
        });
    });

    async function testRoomHistory(func) {
        // Create test players.
        const player1 = new Player('Fred', 'fred@example.com');
        player1.playerID = OWNER_PLAYER_ID;
        const player2 = new Player('Barney', 'barney@example.com');
        player2.playerID = PLAYER_ID;
        await playerCollection.create(player1);
        await playerCollection.create(player2);

        // Create test room.
        let room = new Room(TEST_ROOM_CODE, player1.playerID);
        await collection.create(room);

        // Create test games.
        const game1 = new Game(room.roomID, [player1.playerID, player2.playerID]);
        game1.gameID = PREV_GAME_ID;
        const game2 = new Game(room.roomID, [player1.playerID, player2.playerID]);
        game2.gameID = GAME_ID;
        await gameCollection.create(game1);
        await gameCollection.create(game2);

        // Add test games to test room's previous games.
        for (let gameID of [game1.gameID, game2.gameID, 'new-game']) {
            await collection.setCurrentGameForRoom(room, gameID);
            room = await collection.getByID(room.roomID);
        }

        // Call function to get room history and validate the result.
        const history = await func(room);
        expect(history).toEqual({
            roomID: room.roomID,
            roomCode: room.roomCode,
            ownerPlayerID: room.ownerPlayerID,
            hostPlayerID: room.hostPlayerID,
            currentGameID: room.currentGameID,
            currentChampion: room.currentChampion,
            currentWinningStreak: room.currentWinningStreak,
            createdTime: room.createdTime,
            previousGames: [
                {
                    gameID: game1.gameID,
                    playerIDs: game1.playerIDs,
                    createdTime: game1.createdTime,
                    finishedTime: game1.finishedTime,
                    scores: game1.scores,
                },
                {
                    gameID: game2.gameID,
                    playerIDs: game2.playerIDs,
                    createdTime: game2.createdTime,
                    finishedTime: game2.finishedTime,
                    scores: game2.scores,
                },
            ],
            players: [
                {
                    playerID: player1.playerID,
                    name: player1.name,
                    createdTime: player1.createdTime,
                    lastConnectionTime: player1.lastConnectionTime,
                },
                {
                    playerID: player2.playerID,
                    name: player2.name,
                    createdTime: player2.createdTime,
                    lastConnectionTime: player2.lastConnectionTime,
                },
            ],
        });
    }

    describe('getHistoryByID', () => {
        test('returns history for room with matching ID', async () => {
            await testRoomHistory(async (room) => {
                return await collection.getHistoryByID(room.roomID);
            });
        });
    });

    describe('getHistoryByRoomCode', () => {
        test('returns history for room with matching code', async () => {
            await testRoomHistory(async (room) => {
                return await collection.getHistoryByRoomCode(room.roomCode);
            });
        });
    });

    describe('getHistoryByCriteria', () => {
        test('returns history for first room matching criteria', async () => {
            await testRoomHistory(async (room) => {
                return await collection.getHistoryByCriteria({ownerPlayerID: room.ownerPlayerID});
            });
        });
    });
});
