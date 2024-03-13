import {
    EventTypes, LeaderboardKeys,
    Player, PlayerStatsKeys,
    Room,
    RoomLinkRequest,
    RoomLinkRequestResolution,
    StatusCodes,
    validateRoomCode,
    WebsocketEvent,
} from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestDB, getTestMailer } from '../testutils.mjs';
import { WebsocketServer } from '../websockets.mjs';
import RoomAPI from './room.mjs';
import { app } from './testutils.mjs';

const ROOM_CODE = 'TEST';
const OWNER_PLAYER_ID = 'owner';

const ADMIN = new Player('Admin');
const ADMIN_PLAYER_ID = ADMIN.playerID;

describe('RoomAPI', () => {
    let db;
    let wss;
    let mailer;
    let api;

    beforeAll(async () => {
        db = await getTestDB();
        wss = new WebsocketServer(db);
        mailer = await getTestMailer();
        api = new RoomAPI(db, wss, mailer, [ADMIN_PLAYER_ID]);
    });

    beforeEach(async () => {
        await db.players.truncate(true);
        await db.rooms.truncate(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await db.close();
    });

    describe('constructor', () => {
        test('with DB and mailer', () => {
            expect(api.db).toBe(db);
            expect(api.mailer).toBe(mailer);
        });

        test('creates expected routes', () => {
            expect(api._router.stack).toHaveLength(5);

            const getRoomsRoute = api._router.stack[0].route;
            expect(getRoomsRoute.path).toEqual('/');
            expect(getRoomsRoute.methods).toEqual({get: true});

            const createRoomRoute = api._router.stack[1].route;
            expect(createRoomRoute.path).toEqual('/');
            expect(createRoomRoute.methods).toEqual({post: true});

            const getRoomRoute = api._router.stack[2].route;
            expect(getRoomRoute.path).toEqual('/:roomID');
            expect(getRoomRoute.methods).toEqual({get: true});

            const getRoomHistoryRoute = api._router.stack[3].route;
            expect(getRoomHistoryRoute.path).toEqual('/:roomID/history');
            expect(getRoomHistoryRoute.methods).toEqual({get: true});

            const getRoomLeaderboardRoute = api._router.stack[4].route;
            expect(getRoomLeaderboardRoute.path).toEqual('/:roomID/leaderboard');
            expect(getRoomLeaderboardRoute.methods).toEqual({get: true});
        });
    });

    describe('handleGetRooms', () => {
        test('invalid page', async () => {
            const page = -1;
            const response = await app(api).get(`/?page=${page}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid page "${page}"`);
        });

        test('page number too high', async () => {
            const page = 2;
            const response = await app(api).get(`/?page=${page}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid page "${page}"`);
        });

        test('no results', async () => {
            const response = await app(api).get('/');
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual({more: false, total: 0, page: 1, rooms: [], playerNames: {}});
        });

        test('not all players found', async () => {
            const room = new Room(ROOM_CODE, OWNER_PLAYER_ID);
            await db.rooms.create(room);
            const response = await app(api).get('/');
            expect(response.status).toEqual(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(response.body.error).toEqual('Failed to get players');
        });

        test('successful pagination response', async () => {
            const player = new Player('Fred');
            const rooms = [
                new Room(ROOM_CODE, player.playerID),
                new Room('FRED', player.playerID),
                new Room('PLAY', player.playerID),
                new Room('GAME', player.playerID),
            ];
            await db.players.create(player);
            await db.rooms.createMany(rooms);
            const response = await app(api).get('/');
            expect(response.ok).toBeTruthy();
            expect(response.body.more).toBeFalsy();
            expect(response.body.total).toEqual(rooms.length);
            expect(response.body.page).toEqual(1);
            expect(response.body.rooms).toHaveLength(rooms.length);
            expect(response.body.playerNames).toEqual({[player.playerID]: player.name});
        });
    });

    describe('handleCreateRoom', () => {
        const OWNER = new Player('Fred');
        const OWNER_PLAYER_ID = OWNER.playerID;

        beforeEach(async () => await db.players.create(OWNER));

        test('invalid owner', async () => {
            const ownerPlayerID = 'not-found';
            const room = {ownerPlayerID: ownerPlayerID};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid owner player ID "${ownerPlayerID}"`);
        });

        test('invalid password', async () => {
            const room = {ownerPlayerID: OWNER_PLAYER_ID, password: ''};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Invalid password');
        });

        test('invalid room code', async () => {
            const roomCode = '😈';
            const room = {ownerPlayerID: OWNER_PLAYER_ID, roomCode: roomCode};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid room code "${roomCode}"`);
        });

        test('duplicate room code', async () => {
            const existingRoom = new Room(ROOM_CODE, OWNER_PLAYER_ID);
            await db.rooms.create(existingRoom);
            const room = {ownerPlayerID: OWNER_PLAYER_ID, roomCode: ROOM_CODE};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.CONFLICT);
            expect(response.body.error).toEqual(`Room with code "${ROOM_CODE}" already exists`);
        });

        test('invalid room link request - not found', async () => {
            const requestID = 'not-found';
            const room = {ownerPlayerID: OWNER_PLAYER_ID, requestID: requestID};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid room link request ID "${requestID}"`);
        });

        test('invalid room link request - not approved', async () => {
            const roomLinkRequest = new RoomLinkRequest('Barney', 'barney@example.com');
            await db.roomLinkRequests.create(roomLinkRequest);
            const room = {ownerPlayerID: OWNER_PLAYER_ID, requestID: roomLinkRequest.requestID};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid room link request ID "${roomLinkRequest.requestID}"`);
        });

        test('invalid room link request - already redeemed', async () => {
            const roomLinkRequest = new RoomLinkRequest('Barney', 'barney@example.com');
            roomLinkRequest.resolution = RoomLinkRequestResolution.APPROVED;
            roomLinkRequest.roomID = 'room';
            await db.roomLinkRequests.create(roomLinkRequest);
            const room = {ownerPlayerID: OWNER_PLAYER_ID, requestID: roomLinkRequest.requestID};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Room link request "${roomLinkRequest.requestID}" has already been redeemed`);
        });

        test('missing room link request and owner is not admin', async () => {
            const room = {ownerPlayerID: OWNER_PLAYER_ID};
            const response = await app(api).post('/').send(room);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Missing room link request ID');
        });

        test('successful creation - admin', async () => {
            ADMIN.currentRoomID = null;
            await db.players.create(ADMIN);

            const spy = jest.spyOn(mailer, 'sendRoomCreatedMessage');
            const room = {ownerPlayerID: ADMIN_PLAYER_ID, roomCode: ROOM_CODE, password: 'secret'};
            const response = await app(api).post('/').send(room);
            expect(response.ok).toBeTruthy();
            expect(response.body.roomID).toBeDefined();
            expect(response.body.roomCode).toEqual(room.roomCode);
            expect(validateRoomCode(response.body.roomCode)).toBeTruthy();
            expect(response.body.passwordHash).toBeDefined();
            expect(response.body.ownerPlayerID).toEqual(room.ownerPlayerID);
            expect(response.body.hostPlayerID).toEqual(room.ownerPlayerID);
            expect(response.body.playerIDs).toEqual([room.ownerPlayerID]);
            expect(response.body.kickedPlayerIDs).toEqual({});
            expect(response.body.currentGameID).toBeNull();
            expect(response.body.currentChampion).toBeNull();
            expect(response.body.currentWinningStreak).toEqual(0);
            expect(response.body.previousGameIDs).toEqual([]);

            const newRoom = await db.rooms.getByID(response.body.roomID);
            expect(newRoom.roomID).toEqual(response.body.roomID);
            expect(newRoom.roomCode).toEqual(room.roomCode);
            expect(newRoom.ownerPlayerID).toEqual(room.ownerPlayerID);
            expect(newRoom.hostPlayerID).toEqual(room.ownerPlayerID);

            const admin = await db.players.getByID(room.ownerPlayerID);
            expect(admin.currentRoomID).toEqual(newRoom.roomID);

            expect(spy).not.toHaveBeenCalled();
        });

        test('successful creation - player with room link request', async () => {
            const spy = jest.spyOn(mailer, 'sendRoomCreatedMessage');
            const roomLinkRequest = new RoomLinkRequest('Barney', 'barney@example.com');
            roomLinkRequest.resolution = RoomLinkRequestResolution.APPROVED;
            await db.roomLinkRequests.create(roomLinkRequest);
            expect(roomLinkRequest.roomID).toBeNull();
            expect(roomLinkRequest.roomCode).toBeNull();

            const room = {ownerPlayerID: OWNER_PLAYER_ID, requestID: roomLinkRequest.requestID};
            const response = await app(api).post('/').send(room);
            expect(response.ok).toBeTruthy();
            expect(response.body.roomID).toBeDefined();
            expect(response.body.roomCode).toBeDefined();
            expect(response.body.ownerPlayerID).toEqual(room.ownerPlayerID);

            const newRequest = await db.roomLinkRequests.getByID(roomLinkRequest.requestID);
            expect(newRequest.roomID).toEqual(response.body.roomID);
            expect(newRequest.roomCode).toEqual(response.body.roomCode);

            const owner = await db.players.getByID(room.ownerPlayerID);
            expect(owner.currentRoomID).toEqual(response.body.roomID);

            expect(spy).toHaveBeenCalledWith(response.body.roomCode, roomLinkRequest);
        });

        test('player removed from previous room and host reassigned if necessary', async () => {
            let existingRoom = new Room(ROOM_CODE, ADMIN_PLAYER_ID);
            existingRoom.playerIDs = [ADMIN_PLAYER_ID, OWNER_PLAYER_ID];
            await db.rooms.create(existingRoom);

            ADMIN.currentRoomID = existingRoom.roomID;
            await db.players.create(ADMIN);

            await db.players.updateByID(OWNER_PLAYER_ID, {currentRoomID: existingRoom.roomID});

            const spy = jest.spyOn(wss, 'broadcast');
            const room = {ownerPlayerID: ADMIN_PLAYER_ID};
            const response = await app(api).post('/').send(room);
            expect(response.ok).toBeTruthy();
            expect(response.body.roomID).toBeDefined();
            expect(response.body.roomCode).toBeDefined();
            expect(response.body.ownerPlayerID).toEqual(room.ownerPlayerID);

            const admin = await db.players.getByID(room.ownerPlayerID);
            expect(admin.currentRoomID).toEqual(response.body.roomID);

            existingRoom = await db.rooms.getByID(existingRoom.roomID);
            expect(existingRoom.hostPlayerID).toEqual(OWNER_PLAYER_ID);

            expect(spy).toHaveBeenCalledWith(
                new WebsocketEvent(
                    EventTypes.PLAYER_LEFT_ROOM,
                    {roomID: existingRoom.roomID, playerID: ADMIN_PLAYER_ID, newHostPlayerID: OWNER_PLAYER_ID}),
                ADMIN_PLAYER_ID
            );
        });
    });

    describe('handleGetRoom', () => {
        test('existing room', async () => {
            const room = new Room(ROOM_CODE, OWNER_PLAYER_ID);
            await db.rooms.create(room);
            room.createdTime = room.createdTime.toISOString();

            const response = await app(api).get(`/${room.roomID}`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(room);
        });

        test('room not found', async () => {
            const roomID = 'room';
            const response = await app(api).get(`/${roomID}`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room "${roomID}" not found`);
        });
    });

    describe('handleGetRoomHistory', () => {
        function getExpectedRoomHistory(room) {
            return {
                createdTime: room.createdTime.toISOString(),
                currentChampion: room.currentChampion,
                currentGameID: room.currentGameID,
                currentWinningStreak: room.currentWinningStreak,
                hostPlayerID: room.hostPlayerID,
                ownerPlayerID: room.ownerPlayerID,
                players: [],
                previousGames: [],
                roomCode: room.roomCode,
                roomID: room.roomID,
            };
        }

        test('get history by room code', async () => {
            const room = new Room(ROOM_CODE, OWNER_PLAYER_ID);
            await db.rooms.create(room);

            const response = await app(api).get(`/${room.roomCode}/history`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(getExpectedRoomHistory(room));
        });

        test('get history by room ID', async () => {
            const room = new Room(ROOM_CODE, OWNER_PLAYER_ID);
            await db.rooms.create(room);

            const response = await app(api).get(`/${room.roomID}/history`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(getExpectedRoomHistory(room));
        });

        test('room not found', async () => {
            const roomID = 'room';
            const response = await app(api).get(`/${roomID}/history`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room "${roomID}" not found`);
        });
    });

    describe('handleGetRoomLeaderboard', () => {
        let players;
        let expectedLeaderboard;

        function playerWithScore(player, score) {
            return {playerID: player.playerID, name: player.name, score: score};
        }

        beforeEach(async () => {
            players = [
                new Player('Fred'),
                new Player('Barney'),
                new Player('Betty'),
                new Player('Wilma'),
            ];
            // Fred has the highest average score.
            players[0].stats = {
                [PlayerStatsKeys.GAMES_PLAYED]: 4,
                [PlayerStatsKeys.GAMES_WON]: 1,
                [PlayerStatsKeys.HIGHEST_GAME_SCORE]: 100,
                [PlayerStatsKeys.OVERALL_SCORE]: 2000,
            };
            // Barney has the highest single-game score.
            players[1].stats = {
                [PlayerStatsKeys.GAMES_PLAYED]: 10,
                [PlayerStatsKeys.GAMES_WON]: 1,
                [PlayerStatsKeys.HIGHEST_GAME_SCORE]: 1000,
                [PlayerStatsKeys.OVERALL_SCORE]: 4000,
            };
            // Betty has the highest overall score.
            players[2].stats = {
                [PlayerStatsKeys.GAMES_PLAYED]: 20,
                [PlayerStatsKeys.GAMES_WON]: 1,
                [PlayerStatsKeys.HIGHEST_GAME_SCORE]: 200,
                [PlayerStatsKeys.OVERALL_SCORE]: 5000,
            };
            // Wilma has the highest winning percentage.
            players[3].stats = {
                [PlayerStatsKeys.GAMES_PLAYED]: 20,
                [PlayerStatsKeys.GAMES_WON]: 15,
                [PlayerStatsKeys.HIGHEST_GAME_SCORE]: 250,
                [PlayerStatsKeys.OVERALL_SCORE]: 2000,
            };
            await db.players.createMany(players);

            expectedLeaderboard = {
                [LeaderboardKeys.AVERAGE_SCORE]: {
                    '1st': [playerWithScore(players[0], 500)],
                    '2nd': [playerWithScore(players[1], 400)],
                    '3rd': [playerWithScore(players[2], 250)],
                    '4th': [playerWithScore(players[3], 100)],
                },
                [LeaderboardKeys.HIGHEST_GAME_SCORE]: {
                    '1st': [playerWithScore(players[1], 1000)],
                    '2nd': [playerWithScore(players[3], 250)],
                    '3rd': [playerWithScore(players[2], 200)],
                    '4th': [playerWithScore(players[0], 100)],
                },
                [LeaderboardKeys.OVERALL_SCORE]: {
                    '1st': [playerWithScore(players[2], 5000)],
                    '2nd': [playerWithScore(players[1], 4000)],
                    '3rd': [playerWithScore(players[3], 2000), playerWithScore(players[0], 2000)],
                },
                [LeaderboardKeys.WINNING_PERCENTAGE]: {
                    '1st': [playerWithScore(players[3], 75)],
                    '2nd': [playerWithScore(players[0], 25)],
                    '3rd': [playerWithScore(players[1], 10)],
                    '4th': [playerWithScore(players[2], 5)],
                },
            };
        });

        test('get leaderboard by room code', async () => {
            const room = new Room(ROOM_CODE, players[0].playerID);
            room.playerIDs = players.map(player => player.playerID);
            await db.rooms.create(room);

            const response = await app(api).get(`/${room.roomCode}/leaderboard`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(expectedLeaderboard);
        });

        test('get leaderboard by room ID', async () => {
            const room = new Room(ROOM_CODE, players[0].playerID);
            room.playerIDs = players.map(player => player.playerID);
            await db.rooms.create(room);

            const response = await app(api).get(`/${room.roomID}/leaderboard`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(expectedLeaderboard);
        });

        test('room not found', async () => {
            const roomID = 'room';
            const response = await app(api).get(`/${roomID}/leaderboard`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room "${roomID}" not found`);
        });
    });
});
