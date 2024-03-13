import {EventTypes, Player, Room, StatusCodes, WebsocketEvent} from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestDB, getTestMailer } from '../testutils.mjs';
import { WebsocketServer } from '../websockets.mjs';
import { APIError } from './common.mjs';
import PlayerAPI from './player.mjs';
import { app } from './testutils.mjs';

const PLAYER_NAME = 'Fred';
const PLAYER_EMAIL = 'test@example.com';

describe('PlayerAPI', () => {
    let db;
    let wss;
    let mailer;
    let api;

    beforeAll(async () => {
        db = await getTestDB();
        wss = new WebsocketServer(db);
        mailer = await getTestMailer();
        api = new PlayerAPI(db, wss, mailer);
    });

    beforeEach(async () => {
        await db.players.truncate(true);
        await db.rooms.truncate(true);
    });

    afterEach(async () => {
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

            const getPlayersRoute = api._router.stack[0].route;
            expect(getPlayersRoute.path).toEqual('/');
            expect(getPlayersRoute.methods).toEqual({get: true});

            const createPlayerRoute = api._router.stack[1].route;
            expect(createPlayerRoute.path).toEqual('/');
            expect(createPlayerRoute.methods).toEqual({post: true});

            const retrievePlayerRoute = api._router.stack[2].route;
            expect(retrievePlayerRoute.path).toEqual('/retrieve');
            expect(retrievePlayerRoute.methods).toEqual({post: true});

            const getPlayerRoute = api._router.stack[3].route;
            expect(getPlayerRoute.path).toEqual('/:playerID');
            expect(getPlayerRoute.methods).toEqual({get: true});

            const updatePlayerRoute = api._router.stack[4].route;
            expect(updatePlayerRoute.path).toEqual('/:playerID');
            expect(updatePlayerRoute.methods).toEqual({patch: true});
        });
    });

    describe('validatePlayer', () => {
        test('throws error for invalid name', async () => {
            const request = {body: {name: 'really long invalid name'}};
            const expectedError = new APIError('Invalid name "really long invalid name"', StatusCodes.BAD_REQUEST);
            await expect(async () => await api.validatePlayer(request)).rejects.toThrow(expectedError);
        });

        test('throws error for invalid email', async () => {
            const request = {body: {name: PLAYER_NAME, email: 'foo'}};
            const expectedError = new APIError('Invalid email "foo"', StatusCodes.BAD_REQUEST);
            await expect(async () => await api.validatePlayer(request)).rejects.toThrow(expectedError);
        });

        test('throws error for existing player with email', async () => {
            const request = {body: {name: PLAYER_NAME, email: PLAYER_EMAIL}};
            const expectedError = new APIError(`Player with email "${PLAYER_EMAIL}" already exists`, StatusCodes.CONFLICT);
            await db.players.create(new Player('Barney', PLAYER_EMAIL));
            await expect(async () => await api.validatePlayer(request)).rejects.toThrow(expectedError);
        });

        test('returns player for valid request', async () => {
            const request = {body: {name: PLAYER_NAME, email: PLAYER_EMAIL}};
            const player = await api.validatePlayer(request);
            expect(player.playerID).toBeDefined();
            expect(player.name).toEqual(PLAYER_NAME);
            expect(player.email).toEqual(PLAYER_EMAIL);
        });
    });

    describe('handleGetPlayers', () => {
        const TEST_PLAYERS = [
            new Player('Fred', 'fred@example.com'),
            new Player('Betty', 'b3tty@example.com'),
            new Player('Barney', 'barney@example.com'),
            new Player('Wilma', 'wilma@example.com'),
        ];
        TEST_PLAYERS[0].active = false;
        TEST_PLAYERS[1].active = false;

        test('email search - existing player', async () => {
            const player = new Player(PLAYER_NAME, PLAYER_EMAIL);
            await db.players.create(player);
            player.createdTime = player.createdTime.toISOString();
            player.lastConnectionTime = player.lastConnectionTime.toISOString();

            const response = await app(api).get(`/?email=${PLAYER_EMAIL}`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual({more: false, total: 1, page: 1, players: [player]});
        });

        test('email search - player not found', async () => {
            const response = await app(api).get(`/?email=${PLAYER_EMAIL}`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual({more: false, total: 0, page: 1, players: []});
        });

        test('invalid page', async () => {
            const page = -1;
            const response = await app(api).get(`/?page=${page}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid page "${page}"`);
        });

        test('invalid active filter', async () => {
            const active = 'foo';
            const response = await app(api).get(`/?active=${active}`);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid active filter "${active}"`);
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
            expect(response.body).toEqual({more: false, total: 0, page: 1, players: []});
        });

        test('successful pagination response - all players', async () => {
            await db.players.createMany(TEST_PLAYERS);
            const response = await app(api).get('/');
            expect(response.ok).toBeTruthy();
            expect(response.body.more).toBeFalsy();
            expect(response.body.total).toEqual(TEST_PLAYERS.length);
            expect(response.body.page).toEqual(1);
            expect(response.body.players).toHaveLength(TEST_PLAYERS.length);
        });

        test('successful pagination response - active players only', async () => {
            await db.players.createMany(TEST_PLAYERS);
            const response = await app(api).get('/?active=true');
            expect(response.ok).toBeTruthy();
            expect(response.body.more).toBeFalsy();
            expect(response.body.total).toEqual(2);
            expect(response.body.page).toEqual(1);
            expect(response.body.players).toHaveLength(2);
            response.body.players.forEach(player => expect(player.active).toBeTruthy());
        });
    });

    describe('handleCreatePlayer', () => {
        test('invalid player', async () => {
            const player = {name: '', email: PLAYER_EMAIL};
            const response = await app(api).post('/').send(player);
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Invalid name ""');
        });

        test('room does not exist', async () => {
            const player = {name: PLAYER_NAME, email: PLAYER_EMAIL, roomID: 'room'};
            const response = await app(api).post('/').send(player);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Room "${player.roomID}" not found`);
        });

        test('successful creation without room', async () => {
            const mailerSpy = jest.spyOn(mailer, 'sendPlayerRegisteredMessage');
            const wssSpy = jest.spyOn(wss, 'broadcast');
            const player = {name: PLAYER_NAME, email: PLAYER_EMAIL};
            const response = await app(api).post('/').send(player);
            expect(response.ok).toBeTruthy();
            expect(response.body.playerID).toBeDefined();
            expect(response.body.name).toEqual(player.name);
            expect(response.body.email).toEqual(player.email);

            const newPlayer = await db.players.getByID(response.body.playerID);
            expect(newPlayer.playerID).toEqual(response.body.playerID);
            expect(newPlayer.name).toEqual(player.name);
            expect(newPlayer.email).toEqual(player.email);

            expect(mailerSpy).toHaveBeenCalledWith(newPlayer);
            expect(wssSpy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_JOINED, {player: newPlayer}));
        });

        test('successful creation with room', async () => {
            const ownerPlayerID = 'owner';
            const room = new Room('TEST', ownerPlayerID);
            await db.rooms.create(room);
            expect(room.playerIDs).toEqual([ownerPlayerID]);

            const spy = jest.spyOn(wss, 'broadcast');
            const player = {name: PLAYER_NAME, roomID: room.roomID};
            const response = await app(api).post('/').send(player);
            expect(response.ok).toBeTruthy();
            expect(response.body.playerID).toBeDefined();

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([ownerPlayerID, response.body.playerID]);

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('handleRetrievePlayer', () => {
        test('invalid email', async () => {
            const email = 'foo';
            const response = await app(api).post('/retrieve').send({email: email});
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual(`Invalid email "${email}"`);
        });

        test('player not found', async () => {
            const response = await app(api).post('/retrieve').send({email: PLAYER_EMAIL});
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Player with email "${PLAYER_EMAIL}" not found`);
        });

        test('sends email to existing player', async () => {
            const player = new Player(PLAYER_NAME, PLAYER_EMAIL);
            await db.players.create(player);

            const spy = jest.spyOn(mailer, 'sendPlayerRetrievalMessage');
            const response = await app(api).post('/retrieve').send({email: PLAYER_EMAIL});
            expect(response.status).toEqual(StatusCodes.NO_CONTENT);
            expect(spy).toHaveBeenCalledWith(player);
        });
    });

    describe('handleGetPlayer', () => {
        test('existing player', async () => {
            const player = new Player(PLAYER_NAME, PLAYER_EMAIL);
            await db.players.create(player);
            player.createdTime = player.createdTime.toISOString();
            player.lastConnectionTime = player.lastConnectionTime.toISOString();

            const response = await app(api).get(`/${player.playerID}`);
            expect(response.ok).toBeTruthy();
            expect(response.body).toEqual(player);
        });

        test('player not found', async () => {
            const playerID = 'player';
            const response = await app(api).get(`/${playerID}`);
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Player "${playerID}" not found`);
        });
    });

    describe('handleUpdatePlayer', () => {
        test('player not found', async () => {
            const playerID = 'player';
            const response = await app(api).patch(`/${playerID}`).send({name: PLAYER_NAME, email: PLAYER_EMAIL});
            expect(response.status).toEqual(StatusCodes.NOT_FOUND);
            expect(response.body.error).toEqual(`Player "${playerID}" not found`);
        });

        test('invalid player', async () => {
            const player = new Player(PLAYER_NAME, PLAYER_EMAIL);
            await db.players.create(player);

            const response = await app(api).patch(`/${player.playerID}`).send({name: ''});
            expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            expect(response.body.error).toEqual('Invalid name ""');
        });

        test('successfully updates name and email', async () => {
            const oldName = 'Freddie';
            const oldEmail = 'old@example.com';
            const player = new Player(oldName, oldEmail);
            await db.players.create(player);

            const mailerSpy = jest.spyOn(mailer, 'sendPlayerEmailUpdatedMessage');
            const wssSpy = jest.spyOn(wss, 'broadcast');
            const response = await app(api).patch(`/${player.playerID}`).send({name: PLAYER_NAME});
            expect(response.status).toEqual(StatusCodes.NO_CONTENT);
            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.name).toEqual(PLAYER_NAME);
            expect(newPlayer.email).toBeNull();

            expect(mailerSpy).not.toHaveBeenCalled();
            expect(wssSpy).toHaveBeenCalledWith(new WebsocketEvent(
                EventTypes.PLAYER_CHANGED_SETTINGS,
                {playerID: player.playerID, name: newPlayer.name, email: newPlayer.email, prevName: player.name, roomID: player.currentRoomID}
            ));
        });

        test('sends email updated message if email changed', async () => {
            const oldEmail = 'old@example.com';
            const player = new Player(PLAYER_NAME, oldEmail);
            await db.players.create(player);

            const mailerSpy = jest.spyOn(mailer, 'sendPlayerEmailUpdatedMessage');
            const wssSpy = jest.spyOn(wss, 'broadcast');
            const response = await app(api).patch(`/${player.playerID}`).send({name: PLAYER_NAME, email: PLAYER_EMAIL});
            expect(response.status).toEqual(StatusCodes.NO_CONTENT);
            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.name).toEqual(PLAYER_NAME);
            expect(newPlayer.email).toEqual(PLAYER_EMAIL);

            expect(mailerSpy).toHaveBeenCalledWith(PLAYER_NAME, PLAYER_EMAIL, oldEmail);
            expect(wssSpy).toHaveBeenCalled();
        });
    });
});
