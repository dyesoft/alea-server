import { EventTypes, Game, Player, PlayerStatsKeys, Room, StatusCodes, WebsocketEvent } from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestDB } from '../testutils.mjs';
import { WebsocketServer } from '../websockets.mjs';
import GameAPI from './game.mjs';
import { app } from './testutils.mjs';

const MAX_PLAYERS_PER_GAME = 2;

describe('GameAPI', () => {
    let db;
    let wss;
    let api;

    beforeAll(async () => {
        db = await getTestDB();
        wss = new WebsocketServer(db);
        api = new GameAPI(db, wss, MAX_PLAYERS_PER_GAME);
    });

    beforeEach(async () => {
        await db.games.truncate(true);
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
        test('with DB and max players per game', () => {
            expect(api.db).toBe(db);
            expect(api.maxPlayersPerGame).toEqual(MAX_PLAYERS_PER_GAME);
        });

        test('creates expected routes', () => {
            expect(api._router.stack).toHaveLength(2);

            const createGameRoute = api._router.stack[0].route;
            expect(createGameRoute.path).toEqual('/');
            expect(createGameRoute.methods).toEqual({post: true});

            const getGameRoute = api._router.stack[1].route;
            expect(getGameRoute.path).toEqual('/:gameID');
            expect(getGameRoute.methods).toEqual({get: true});
        });
    });

    describe('createNewGame', () => {
        test('returns game for given room and players', async () => {
            const roomID = 'room';
            const playerIDs = ['player1', 'player2', 'player3'];
            const game = await api.createNewGame(null, roomID, playerIDs);
            expect(game.gameID).toBeDefined();
            expect(game.roomID).toEqual(roomID);
            expect(game.playerIDs).toEqual(playerIDs);
            expect(game.createdTime).toBeDefined();
            expect(game.finishedTime).toBeNull();
            playerIDs.forEach(playerID => expect(game.scores[playerID]).toEqual(0));
        });
    });

    describe('handleCreateGame', () => {
        const ROOM = new Room('TEST', 'owner');
        const ROOM_ID = ROOM.roomID;

        const PLAYERS = [
            new Player('Fred'),
            new Player('Barney'),
            new Player('Wilma'),
        ];
        const PLAYER_IDS = PLAYERS.map(player => player.playerID);

        test('invalid room', async () => {
            const roomID = 'not-found';
            const game = {roomID: roomID};
            const response = await app(api).post('/').send(game);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room "${roomID}" not found`);
        });

        test('invalid players', async () => {
            await db.rooms.create(ROOM);

            const playerIDs = ['not-found'];
            const game = {roomID: ROOM_ID, playerIDs: playerIDs};
            const response = await app(api).post('/').send(game);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual('Failed to get players');
        });

        test('too many players', async () => {
            await db.players.createMany(PLAYERS);
            await db.rooms.create(ROOM);

            const game = {roomID: ROOM_ID, playerIDs: PLAYER_IDS};
            const response = await app(api).post('/').send(game);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Maximum number of players (${MAX_PLAYERS_PER_GAME}) exceeded`);
        });

        test('successful creation - no players', async () => {
            await db.rooms.create(ROOM);

            const spy = jest.spyOn(wss, 'broadcast');
            const game = {roomID: ROOM_ID};
            const response = await app(api).post('/').send(game);
            expect(response.ok).toBeTruthy();
            expect(response.body.gameID).toBeDefined();
            expect(response.body.roomID).toEqual(game.roomID);
            expect(response.body.playerIDs).toEqual([]);
            expect(response.body.createdTime).toBeDefined();
            expect(response.body.finishedTime).toBeNull();
            expect(response.body.scores).toEqual({});

            const newGame = await db.games.getByID(response.body.gameID);
            expect(newGame.gameID).toEqual(response.body.gameID);
            expect(newGame.roomID).toEqual(game.roomID);
            expect(newGame.createdTime.toISOString()).toEqual(response.body.createdTime);

            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveBeenNthCalledWith(1, new WebsocketEvent(EventTypes.GAME_STARTING, {roomID: ROOM_ID}));
            expect(spy).toHaveBeenNthCalledWith(2, new WebsocketEvent(EventTypes.GAME_STARTED, {roomID: ROOM_ID, game: newGame}));
        });

        test('successful creation - with players', async () => {
            const players = PLAYERS.slice(0, MAX_PLAYERS_PER_GAME);
            await db.players.createMany(players);
            await db.rooms.create(ROOM);

            const spy = jest.spyOn(wss, 'broadcast');
            const game = {roomID: ROOM_ID, playerIDs: players.map(player => player.playerID)};
            const response = await app(api).post('/').send(game);
            expect(response.ok).toBeTruthy();
            expect(response.body.gameID).toBeDefined();
            expect(response.body.roomID).toEqual(game.roomID);
            expect(response.body.playerIDs).toEqual(game.playerIDs);
            players.forEach(player => expect(response.body.scores[player.playerID]).toEqual(0));

            const newGame = await db.games.getByID(response.body.gameID);
            expect(newGame.gameID).toEqual(response.body.gameID);
            expect(newGame.roomID).toEqual(game.roomID);
            expect(newGame.createdTime.toISOString()).toEqual(response.body.createdTime);

            for (const player of players) {
                const newPlayer = await db.players.getByID(player.playerID);
                expect(newPlayer.stats[PlayerStatsKeys.GAMES_PLAYED]).toEqual(1);
            }

            expect(spy).toHaveBeenCalledTimes(2);
        });
    });

    describe('handleGetGame', () => {
        test('existing game', async () => {
            const game = new Game('TEST', ['owner']);
            await db.games.create(game);
            game.createdTime = game.createdTime.toISOString();

            const response = await app(api).get(`/${game.gameID}`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(game);
        });

        test('game not found', async () => {
            const gameID = 'game';
            const response = await app(api).get(`/${gameID}`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Game "${gameID}" not found`);
        });
    });
});
