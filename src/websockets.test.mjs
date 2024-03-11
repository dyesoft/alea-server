import WebSocket from 'ws';
import { EventContext, EventTypes, Game, Player, Room, StatusCodes, WebsocketEvent } from '@dyesoft/alea-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTestDB } from './testutils.mjs';
import { sleep } from './utils.mjs';
import { NO_ROOM_KEY, RoomLogger, WebsocketServer } from './websockets.mjs';

const ONE_DAY_IN_MILLIS = 24 * 60 * 60 * 1000;

const SLEEP_DELAY_MILLIS = 50;

const MAX_PLAYERS_PER_GAME = 2;
const REASSIGNMENT_DELAY_CHECK_MILLIS = 0;

const GAME_ID = 'game';

const PLAYER_NAME = 'Fred';
const PLAYER_ID = 'player';
const OTHER_PLAYER_ID = 'other-player';

const ROOM_CODE = 'TEST';
const ROOM_ID = 'room';

describe('RoomLogger', () => {
    describe('constructor', () => {
        test('with db', () => {
            const mockDB = {};
            const logger = new RoomLogger(mockDB);
            expect(logger.db).toBe(mockDB);
            expect(logger.loggers).toEqual({});
        });
    });

    describe('getLogger', () => {
        let db;

        beforeAll(async () => {
            db = await getTestDB();
        });

        afterAll(async () => {
            await db.rooms.truncate(true);
            await db.close(true);
        });

        test('creates new logger if no cached logger exists', async () => {
            const room = new Room(ROOM_CODE, 'owner');
            await db.rooms.create(room);

            const logger = new RoomLogger(db);
            expect(logger.loggers[room.roomID]).not.toBeDefined();
            let roomLogger = logger.getLogger(room.roomID);
            expect(roomLogger).not.toBeNull();

            // First call to getLogger might return the default logger because the room is queried asynchronously.
            // After a short delay, it should always return the room-namespaced logger.
            await sleep(SLEEP_DELAY_MILLIS);
            roomLogger = logger.getLogger(room.roomID);
            expect(roomLogger.namespace).toEqual(`ws:${ROOM_CODE.toLowerCase()}`);
            expect(logger.loggers[room.roomID]).toBe(roomLogger);
        });

        test('returns cached logger if found', () => {
            const mockRoomLogger = {};
            const logger = new RoomLogger(null);
            logger.loggers[ROOM_ID] = mockRoomLogger;

            const roomLogger = logger.getLogger(ROOM_ID);
            expect(roomLogger).toBe(mockRoomLogger);
        });
    });

    describe('debug', () => {
        test('logs provided message at debug level', () => {
            const mockDebug = jest.fn();
            const mockRoomLogger = {debug: mockDebug};
            const logger = new RoomLogger(null);
            logger.loggers[ROOM_ID] = mockRoomLogger;

            const message = 'Test debug message';
            logger.debug(ROOM_ID, message);
            expect(mockDebug).toHaveBeenCalledWith(message);
        });
    });

    describe('info', () => {
        test('logs provided message at info level', () => {
            const mockInfo = jest.fn();
            const mockRoomLogger = {info: mockInfo};
            const logger = new RoomLogger(null);
            logger.loggers[ROOM_ID] = mockRoomLogger;

            const message = 'Test info message';
            logger.info(ROOM_ID, message);
            expect(mockInfo).toHaveBeenCalledWith(message);
        });
    });

    describe('error', () => {
        test('logs provided message at error level', () => {
            const mockError = jest.fn();
            const mockRoomLogger = {error: mockError};
            const logger = new RoomLogger(null);
            logger.loggers[ROOM_ID] = mockRoomLogger;

            const message = 'Test error message';
            logger.error(ROOM_ID, message);
            expect(mockError).toHaveBeenCalledWith(message);
        });
    });
});

function getMockWebsocket(open = true) {
    return {
        readyState: (open ? WebSocket.OPEN : WebSocket.CLOSED),
        ping: jest.fn(),
        pong: jest.fn(),
        send: jest.fn(),
    };
}

function expectWebsocketEvent(ws, event) {
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify(event));
}

function expectWebsocketErrorEvent(ws, event, message, status) {
    const expectedErrorEvent = new WebsocketEvent(EventTypes.ERROR, {eventType: event.eventType, error: message, status: status});
    expectWebsocketEvent(ws, expectedErrorEvent);
}

async function expectGameNotFoundEvent(wss, eventType, payload) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, 'game not found', StatusCodes.NOT_FOUND);
}

async function expectMissingPlayerIDEvent(wss, eventType, payload, message) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, message || 'missing player ID', StatusCodes.BAD_REQUEST);
}

async function expectPlayerNotFoundEvent(wss, eventType, payload) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, 'player not found', StatusCodes.NOT_FOUND);
}

async function expectPlayerNotInRoomEvent(wss, eventType, payload) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, 'player not in room', StatusCodes.BAD_REQUEST);
}

async function expectMaxPlayersExceededEvent(wss, eventType, payload) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, 'max players exceeded', StatusCodes.BAD_REQUEST);
}

async function expectMissingRoomIDEvent(wss, eventType, payload, message) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, message || 'missing room ID', StatusCodes.BAD_REQUEST);
}

async function expectRoomNotFoundEvent(wss, eventType, payload, message) {
    const event = new WebsocketEvent(eventType, payload);
    const mockWS = getMockWebsocket();
    const handler = wss.eventHandlers[eventType];
    await handler(mockWS, event);
    expectWebsocketErrorEvent(mockWS, event, message || 'room not found', StatusCodes.NOT_FOUND);
}

function tomorrow() {
    return Date.now() + ONE_DAY_IN_MILLIS;
}

function yesterday() {
    return Date.now() - ONE_DAY_IN_MILLIS;
}

describe('WebsocketServer', () => {
    let db;
    let wss;

    beforeAll(async () => {
        db = await getTestDB();
    });

    beforeEach(() => {
        wss = new WebsocketServer(db, MAX_PLAYERS_PER_GAME, REASSIGNMENT_DELAY_CHECK_MILLIS);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        Object.values(wss.pingHandlers).forEach(clearInterval);
        await db.games.truncate(true);
        await db.players.truncate(true);
        await db.rooms.truncate(true);
    });

    afterAll(async () => {
        await db.close(true);
    });

    describe('constructor', () => {
        const expectedEventTypes = [
            /* connection events */
            EventTypes.CLIENT_CONNECT,
            /* game events */
            EventTypes.GAME_CREATION_FAILED,
            EventTypes.GAME_SETTINGS_CHANGED,
            /* room events */
            EventTypes.REASSIGN_ROOM_HOST,
            /* player events */
            EventTypes.JOIN_ROOM,
            EventTypes.JOIN_ROOM_WITH_CODE,
            EventTypes.LEAVE_ROOM,
            EventTypes.JOIN_GAME,
            EventTypes.START_SPECTATING,
            EventTypes.STOP_SPECTATING,
            /* host-only events */
            EventTypes.ABANDON_GAME,
            EventTypes.KICK_PLAYER,
        ];

        test('with db and max players per game', () => {
            const mockDB = {};
            const maxPlayers = 5;
            const wss = new WebsocketServer(mockDB, maxPlayers);
            expect(wss.db).toBe(mockDB);
            expect(wss.maxPlayersPerGame).toEqual(maxPlayers);
            expect(wss.roomLogger).toBeDefined();
            expect(wss.connectedClients).toEqual({});
            expect(wss.pingHandlers).toEqual({});
            expect(wss.playerNames).toEqual({});

            const eventTypes = Object.keys(wss.eventHandlers);
            expect(eventTypes).toHaveLength(expectedEventTypes.length);
            expect(eventTypes.sort()).toEqual(expectedEventTypes.sort());
        });
    });

    describe('addClient', () => {
        test('creates cache for room if not present', () => {
            expect(wss.connectedClients[ROOM_ID]).not.toBeDefined();
            wss.addClient(ROOM_ID, PLAYER_ID, null);
            expect(wss.connectedClients[ROOM_ID]).toBeDefined();
        });

        test('adds websocket for player to client cache for room', () => {
            const mockWS = {};
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS);
            expect(wss.getClient(ROOM_ID, PLAYER_ID)).toEqual(mockWS);
        });

        test('removes websocket for player from NO_ROOM cache if present', () => {
            const mockWS = {};
            wss.addClient(NO_ROOM_KEY, PLAYER_ID, mockWS);
            expect(wss.getClient(NO_ROOM_KEY, PLAYER_ID)).toEqual(mockWS);
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS);
            expect(wss.getClient(ROOM_ID, PLAYER_ID)).toEqual(mockWS);
            expect(wss.getClient(NO_ROOM_KEY, PLAYER_ID)).toBeNull();
        });
    });

    describe('removeClient', () => {
        test('does nothing if player not present in room cache', () => {
            const ws = wss.removeClient(ROOM_ID, PLAYER_ID);
            expect(ws).toBeNull();
        });

        test('removes websocket for player from room cache if present', () => {
            const mockWS = {};
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS);
            expect(wss.getClient(ROOM_ID, PLAYER_ID)).toEqual(mockWS);
            const ws = wss.removeClient(ROOM_ID, PLAYER_ID);
            expect(ws).toBe(mockWS);
            expect(wss.getClient(ROOM_ID, PLAYER_ID)).toBeNull();
        });

        test('removes cache for room if empty', () => {
            wss.addClient(ROOM_ID, PLAYER_ID, null);
            expect(wss.connectedClients[ROOM_ID]).toBeDefined();
            wss.removeClient(ROOM_ID, PLAYER_ID);
            expect(wss.connectedClients[ROOM_ID]).not.toBeDefined();
        });
    });

    describe('getClients', () => {
        test('returns cache for room if present', () => {
            const mockWS = {};
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS);
            expect(wss.getClients(ROOM_ID)).toEqual({[PLAYER_ID]: mockWS});
        });

        test('returns empty cache if not present', () => {
            expect(wss.getClients(ROOM_ID)).toEqual({});
        });
    });

    describe('getClient', () => {
        test('returns websocket for player if present in room cache', () => {
            const mockWS = {};
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS);
            expect(wss.getClient(ROOM_ID, PLAYER_ID)).toEqual(mockWS);
        });

        test('returns null if player not present in room cache', () => {
            expect(wss.getClient(ROOM_ID, PLAYER_ID)).toBeNull();
        });
    });

    describe('getPlayerName', () => {
        test('returns player name if present in cache', () => {
            wss.playerNames[PLAYER_ID] = PLAYER_NAME;
            expect(wss.getPlayerName(PLAYER_ID)).toEqual(PLAYER_NAME);
        });

        test('returns player ID if not present in cache', () => {
            expect(wss.getPlayerName(PLAYER_ID)).toEqual(PLAYER_ID);
        });
    });

    describe('broadcast', () => {
        const event = new WebsocketEvent(EventTypes.GAME_SETTINGS_CHANGED, {roomID: ROOM_ID});

        test('does nothing if room ID not present in event payload', () => {
            const spy = jest.spyOn(wss, 'getClients');
            expect(() => wss.broadcast(new WebsocketEvent())).not.toThrowError();
            expect(spy).not.toHaveBeenCalled();
        });

        test('sends event to all connected clients in room', () => {
            const mockWS = getMockWebsocket();
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS);
            wss.addClient(ROOM_ID, OTHER_PLAYER_ID, mockWS);

            wss.broadcast(event);
            expect(mockWS.send).toHaveBeenCalledTimes(2);
            expectWebsocketEvent(mockWS, event);
        });

        test('skips sending event to originating player if provided', () => {
            const mockWS1 = getMockWebsocket();
            const mockWS2 = getMockWebsocket();
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS1);
            wss.addClient(ROOM_ID, OTHER_PLAYER_ID, mockWS2);

            wss.broadcast(event, PLAYER_ID);
            expect(mockWS1.send).not.toHaveBeenCalled();
            expect(mockWS2.send).toHaveBeenCalledTimes(1);
        });

        test('skips sending event to websockets that are not in OPEN state', () => {
            const mockWS1 = getMockWebsocket();
            const mockWS2 = getMockWebsocket(false);
            wss.addClient(ROOM_ID, PLAYER_ID, mockWS1);
            wss.addClient(ROOM_ID, OTHER_PLAYER_ID, mockWS2);

            wss.broadcast(event);
            expect(mockWS1.send).toHaveBeenCalledTimes(1);
            expect(mockWS2.send).not.toHaveBeenCalled();
        });
    });

    describe('handleWebsocket', () => {
        let handlers;
        let mockWS;

        beforeEach(() => {
            handlers = {};
            mockWS = getMockWebsocket();
            mockWS.on = (eventType, handler) => handlers[eventType] = handler;
            // Call handleWebsocket to define handlers on mockWS.
            wss.handleWebsocket(mockWS);
        });

        test('defines handlers for expected websocket events', () => {
            expect(handlers.message).toBeDefined();
            expect(handlers.ping).toBeDefined();
            expect(handlers.pong).toBeDefined();
            expect(handlers.close).toBeDefined();
        });

        describe('message handler', () => {
            test('does nothing if message cannot be parsed', async () => {
                await expect(async () => await handlers.message({})).resolves;
                expect(mockWS.send).not.toHaveBeenCalled();
            });

            test('does nothing if event type is not supported', async () => {
                const event = new WebsocketEvent(EventTypes.ERROR);
                await expect(async () => await handlers.message(JSON.stringify(event))).resolves;
                expect(mockWS.send).not.toHaveBeenCalled();
            });

            test('invokes handler for event type', async () => {
                const eventType = EventTypes.ERROR;
                const event = new WebsocketEvent(eventType);
                const mockHandler = jest.fn();
                wss.eventHandlers[eventType] = mockHandler;

                await handlers.message(JSON.stringify(event));
                expect(mockHandler).toHaveBeenCalledWith(mockWS, event);
            });

            test('sends error event to client if handler throws error and websocket in OPEN state', async () => {
                const eventType = EventTypes.ERROR;
                const event = new WebsocketEvent(eventType);
                const errorMessage = 'test error';
                wss.eventHandlers[eventType] = jest.fn().mockRejectedValue(new Error(errorMessage));

                await handlers.message(JSON.stringify(event));
                expectWebsocketErrorEvent(mockWS, event, errorMessage, StatusCodes.INTERNAL_SERVER_ERROR);
            });

            test('does nothing if handler throws error and websocket not in OPEN state', async () => {
                const eventType = EventTypes.ERROR;
                const event = new WebsocketEvent(eventType);
                wss.eventHandlers[eventType] = jest.fn().mockRejectedValue(new Error('test error'));
                mockWS.readyState = WebSocket.CLOSED;

                await expect(async () => await handlers.message(JSON.stringify(event))).resolves;
                expect(mockWS.send).not.toHaveBeenCalled();
            });
        });

        describe('ping handler', () => {
            const data = 'Test ping';

            test('sends pong back if websocket in OPEN state', () => {
                handlers.ping(data);
                expect(mockWS.pong).toHaveBeenCalledWith(data);
            });

            test('does nothing if websocket not in OPEN state', () => {
                mockWS.readyState = WebSocket.CLOSED;
                handlers.ping(data);
                expect(mockWS.pong).not.toHaveBeenCalled();
            });
        });

        describe('pong handler', () => {
            test('logs pong data', () => {
                expect(() => handlers.pong('Test pong')).not.toThrowError();
            });
        });

        describe('close handler', () => {
            const code = StatusCodes.SERVICE_UNAVAILABLE;
            const reason = 'Websocket closed by client';

            test('removes ping handler for websocket if present', () => {
                const pingHandler = {};
                wss.pingHandlers[mockWS] = pingHandler;
                expect(wss.pingHandlers[mockWS]).toEqual(pingHandler);

                handlers.close(code, reason);
                expect(wss.pingHandlers[mockWS]).not.toBeDefined();
            });

            test('updates player in DB and broadcasts event to all players in room', async () => {
                const player = new Player(PLAYER_NAME);
                player.currentRoomID = ROOM_ID;
                await db.players.create(player);
                const room = new Room(ROOM_CODE, PLAYER_ID);
                await db.rooms.create(room);
                wss.addClient(room.roomID, player.playerID, mockWS);

                const spy = jest.spyOn(wss, 'broadcast');
                handlers.close(code, reason);
                await sleep(SLEEP_DELAY_MILLIS);  // Wait for asynchronous updates
                expect(wss.getClient(room.roomID, player.playerID)).toBeNull();

                const newPlayer = await db.players.getByID(player.playerID);
                expect(newPlayer.active).toBeFalsy();
                expect(newPlayer.currentRoomID).toBeNull();

                const expectedEvent = new WebsocketEvent(EventTypes.PLAYER_WENT_INACTIVE, {roomID: room.roomID, playerID: player.playerID});
                expect(spy).toHaveBeenCalledWith(expectedEvent);
            });

            test('reassigns room host if player was host', async () => {
                const player = new Player(PLAYER_NAME);
                await db.players.create(player);
                const ownerPlayerID = 'owner';
                const room = new Room(ROOM_CODE, ownerPlayerID);
                room.hostPlayerID = player.playerID;
                await db.rooms.create(room);
                wss.addClient(room.roomID, player.playerID, mockWS);

                handlers.close(code, reason);
                await sleep(SLEEP_DELAY_MILLIS);  // Wait for asynchronous updates
                const newRoom = await db.rooms.getByID(room.roomID);
                expect(newRoom.hostPlayerID).toEqual(ownerPlayerID);
            });
        });
    });

    describe('handleError', () => {
        test('sends error event to websocket if in OPEN state', () => {
            const mockWS = getMockWebsocket();
            const event = new WebsocketEvent(EventTypes.GAME_SETTINGS_CHANGED);
            const message = 'test error';
            const status = StatusCodes.INTERNAL_SERVER_ERROR;
            wss.handleError(mockWS, event, message, status);
            expectWebsocketErrorEvent(mockWS, event, message, status);
        });

        test('does nothing if websocket not in OPEN state', () => {
            const mockWS = getMockWebsocket(false);
            wss.handleError(mockWS, new WebsocketEvent(), 'test error', StatusCodes.INTERNAL_SERVER_ERROR);
            expect(mockWS.send).not.toHaveBeenCalled();
        });
    });

    describe('validateEventContext', () => {
        const eventType = EventTypes.JOIN_GAME;

        function eventWithContext(context) {
            return new WebsocketEvent(eventType, {context: context});
        }

        test('sends error response if room ID missing', async () => {
            const event = new WebsocketEvent(eventType);
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, 'missing room ID', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if game ID missing', async () => {
            const event = eventWithContext(new EventContext(ROOM_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, 'missing game ID', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if player ID missing', async () => {
            const event = eventWithContext(new EventContext(ROOM_ID, GAME_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, 'missing player ID', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if room not found', async () => {
            const event = eventWithContext(new EventContext(ROOM_ID, GAME_ID, PLAYER_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, `room "${ROOM_ID}" not found`, StatusCodes.NOT_FOUND);
        });

        test('sends error response if game not found', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.rooms.create(room);

            const event = eventWithContext(new EventContext(room.roomID, GAME_ID, PLAYER_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, `game "${GAME_ID}" not found`, StatusCodes.NOT_FOUND);
        });

        test('sends error response if game not active in room', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID);
            await db.games.create(game);
            await db.rooms.create(room);

            const event = eventWithContext(new EventContext(room.roomID, game.gameID, PLAYER_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, `game ${game.gameID} is not active in room ${room.roomID}`, StatusCodes.BAD_REQUEST);
        });

        test('sends error response if player not in game', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID);
            room.currentGameID = game.gameID;
            await db.games.create(game);
            await db.rooms.create(room);

            const event = eventWithContext(new EventContext(room.roomID, game.gameID, PLAYER_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toBeNull();
            expect(result.room).toBeNull();
            expectWebsocketErrorEvent(mockWS, event, `player ${PLAYER_ID} is not in game ${game.gameID}`, StatusCodes.BAD_REQUEST);
        });

        test('returns game and room if context is valid', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID, [PLAYER_ID]);
            room.currentGameID = game.gameID;
            await db.games.create(game);
            await db.rooms.create(room);

            const event = eventWithContext(new EventContext(room.roomID, game.gameID, PLAYER_ID));
            const mockWS = getMockWebsocket();
            const result = await wss.validateEventContext(mockWS, event);
            expect(result.game).toEqual(game);
            expect(result.room).toEqual(room);
            expect(mockWS.send).not.toHaveBeenCalled();
        });
    });

    describe('handleClientConnect', () => {
        const eventType = EventTypes.CLIENT_CONNECT;

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType);
        });

        test('sends error response if player not found', async () => {
            await expectPlayerNotFoundEvent(wss, eventType, {playerID: PLAYER_ID});
        });

        test('sends error response if room not found', async () => {
            const player = new Player(PLAYER_NAME);
            await db.players.create(player);
            await expectRoomNotFoundEvent(wss, eventType, {playerID: player.playerID, roomID: ROOM_ID});
        });

        test('sends error response if player currently kicked from room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.kickedPlayerIDs[player.playerID] = tomorrow();  // Kicked for 1 day
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomID: room.roomID});
            const mockWS = getMockWebsocket();
            await wss.handleClientConnect(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'player was kicked from room', StatusCodes.CONFLICT);
        });

        test('removes player from kicked players in room if expiration is in the past', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.kickedPlayerIDs[player.playerID] = yesterday();  // Kick expired 1 day ago
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomID: room.roomID});
            const mockWS = getMockWebsocket();
            await wss.handleClientConnect(mockWS, event);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.kickedPlayerIDs[player.playerID]).not.toBeDefined();
        });

        test('removes player from previous room if present', async () => {
            const player = new Player(PLAYER_NAME);
            const otherRoom = new Room('ROOM', player.playerID);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = otherRoom.roomID;
            await db.players.create(player);
            await db.rooms.createMany([room, otherRoom]);

            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomID: room.roomID});
            const mockWS = getMockWebsocket();
            await wss.handleClientConnect(mockWS, event);
            const newRoom = await db.rooms.getByID(otherRoom.roomID);
            expect(newRoom.playerIDs).not.toContain(player.playerID);
            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toEqual(room.roomID);
        });

        test('success - with room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.active = false;
            player.lastConnectionTime = null;
            room.playerIDs = [];
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomID: room.roomID});
            const mockWS = getMockWebsocket();
            await wss.handleClientConnect(mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBe(mockWS);
            expect(wss.playerNames[player.playerID]).toEqual(player.name);
            expect(wss.pingHandlers[mockWS]).toBeDefined();

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.active).toBeTruthy();
            expect(newPlayer.lastConnectionTime).not.toBeNull();
            expect(newPlayer.currentRoomID).toEqual(room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([player.playerID]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_WENT_ACTIVE, {roomID: room.roomID, playerID: player.playerID, players: {[player.playerID]: player}}));
        });

        test('success - without room', async () => {
            const player = new Player(PLAYER_NAME);
            player.active = false;
            player.lastConnectionTime = null;
            await db.players.create(player);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {playerID: player.playerID});
            const mockWS = getMockWebsocket();
            await wss.handleClientConnect(mockWS, event);
            expect(wss.getClient(NO_ROOM_KEY, player.playerID)).toBe(mockWS);
            expect(wss.playerNames[player.playerID]).toEqual(player.name);
            expect(wss.pingHandlers[mockWS]).toBeDefined();

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.active).toBeTruthy();
            expect(newPlayer.lastConnectionTime).not.toBeNull();
            expect(newPlayer.currentRoomID).toBeNull();

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('handleGameCreationFailed', () => {
        const eventType = EventTypes.GAME_CREATION_FAILED;

        test('broadcasts event to all players in room', async () => {
            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: ROOM_ID, error: 'failed to create game'});
            await wss.handleGameCreationFailed(getMockWebsocket(), event);
            expect(spy).toHaveBeenCalledWith(event);
        });
    });

    describe('handleGameSettingsChanged', () => {
        const eventType = EventTypes.GAME_SETTINGS_CHANGED;

        test('broadcasts event to all players in room', async () => {
            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: ROOM_ID, mode: 'random'});
            await wss.handleGameSettingsChanged(getMockWebsocket(), event);
            expect(spy).toHaveBeenCalledWith(event);
        });
    });

    describe('handleReassignRoomHost', () => {
        const eventType = EventTypes.REASSIGN_ROOM_HOST;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if new host player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType, {roomID: ROOM_ID}, 'missing new host player ID');
        });

        test('sends error response if room not found', async () => {
            await expectRoomNotFoundEvent(wss, eventType, {roomID: ROOM_ID, newHostPlayerID: PLAYER_ID});
        });

        test('sends error response if player not found', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.rooms.create(room);
            await expectPlayerNotFoundEvent(wss, eventType, {roomID: room.roomID, newHostPlayerID: PLAYER_ID});
        });

        test('sends error response if player not in room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.players.create(player);
            await db.rooms.create(room);
            await expectPlayerNotInRoomEvent(wss, eventType, {roomID: room.roomID, newHostPlayerID: player.playerID});
        });

        test('success - reassigns room host', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = room.roomID;
            room.hostPlayerID = PLAYER_ID;
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: room.roomID, newHostPlayerID: player.playerID});
            await wss.handleReassignRoomHost(getMockWebsocket(), event);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.hostPlayerID).toEqual(player.playerID);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.ROOM_HOST_REASSIGNED, event.payload));
        });

        test('success - player is already host', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = room.roomID;
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: room.roomID, newHostPlayerID: player.playerID});
            await wss.handleReassignRoomHost(getMockWebsocket(), event);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom).toEqual(room);

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('handleJoinRoom', () => {
        const eventType = EventTypes.JOIN_ROOM;

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType);
        });

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType, {playerID: PLAYER_ID});
        });

        test('sends error response if player not found', async () => {
            await expectPlayerNotFoundEvent(wss, eventType, {playerID: PLAYER_ID, roomID: ROOM_ID});
        });

        test('sends error response if room not found', async () => {
            const player = new Player(PLAYER_NAME);
            await db.players.create(player);
            await expectRoomNotFoundEvent(wss, eventType, {playerID: player.playerID, roomID: ROOM_ID});
        });

        test('sends error response if room is password-protected and player has not previously joined', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID, 'test-password');
            await db.players.create(player);
            await db.rooms.create(room);
            await expectPlayerNotInRoomEvent(wss, eventType, {playerID: player.playerID, roomID: room.roomID});
        });

        test('success - player joins room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.playerIDs = [];
            await db.players.create(player);
            await db.rooms.create(room);

            expect(wss.getClient(room.roomID, player.playerID)).toBeNull();
            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomID: room.roomID});
            const mockWS = getMockWebsocket();
            await wss.handleJoinRoom(mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBe(mockWS);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toEqual(room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([player.playerID]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_JOINED_ROOM, {roomID: room.roomID, playerID: player.playerID, players: {[player.playerID]: newPlayer}}));
        });
    });

    describe('handleJoinRoomWithCode', () => {
        const eventType = EventTypes.JOIN_ROOM_WITH_CODE;

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType);
        });

        test('sends error response if room code missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType, {playerID: PLAYER_ID}, 'missing room code');
        });

        test('sends error response if player not found', async () => {
            await expectPlayerNotFoundEvent(wss, eventType, {playerID: PLAYER_ID, roomCode: ROOM_ID});
        });

        test('sends error response if room not found', async () => {
            const player = new Player(PLAYER_NAME);
            await db.players.create(player);
            await expectRoomNotFoundEvent(wss, eventType, {playerID: player.playerID, roomCode: ROOM_ID});
        });

        test('sends error response if room is password-protected and password is incorrect', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID, 'test-password');
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomCode: room.roomCode, password: 'wrong'});
            const mockWS = getMockWebsocket();
            await wss.handleJoinRoomWithCode(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'invalid password', StatusCodes.UNAUTHORIZED);
        });

        test('success - player joins password-protected room', async () => {
            const password = 'secret';
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID, password);
            room.playerIDs = [];
            await db.players.create(player);
            await db.rooms.create(room);

            expect(wss.getClient(room.roomID, player.playerID)).toBeNull();
            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomCode: room.roomCode, password: password});
            const mockWS = getMockWebsocket();
            await wss.handleJoinRoomWithCode(mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBe(mockWS);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toEqual(room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([player.playerID]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_JOINED_ROOM, {roomID: room.roomID, playerID: player.playerID, players: {[player.playerID]: newPlayer}}));
        });

        test('success - player joins room with no password protection', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.playerIDs = [];
            await db.players.create(player);
            await db.rooms.create(room);

            expect(wss.getClient(room.roomID, player.playerID)).toBeNull();
            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {playerID: player.playerID, roomCode: room.roomCode});
            const mockWS = getMockWebsocket();
            await wss.handleJoinRoomWithCode(mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBe(mockWS);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toEqual(room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([player.playerID]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_JOINED_ROOM, {roomID: room.roomID, playerID: player.playerID, players: {[player.playerID]: newPlayer}}));
        });
    });

    describe('handleLeaveRoom', () => {
        const eventType = EventTypes.LEAVE_ROOM;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType, {roomID: ROOM_ID});
        });

        test('sends error response if room not found', async () => {
            await expectRoomNotFoundEvent(wss, eventType, {roomID: ROOM_ID, playerID: PLAYER_ID});
        });

        test('sends error response if player not found', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.rooms.create(room);
            await expectPlayerNotFoundEvent(wss, eventType, {roomID: room.roomID, playerID: PLAYER_ID});
        });

        test('sends error response if player not in room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.players.create(player);
            await db.rooms.create(room);
            await expectPlayerNotInRoomEvent(wss, eventType, {roomID: room.roomID, playerID: player.playerID});
        });

        test('success - player leaves room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = room.roomID;
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: room.roomID, playerID: player.playerID});
            const mockWS = getMockWebsocket();
            wss.connectedClients[room.roomID] = {[player.playerID]: mockWS};
            await wss.handleLeaveRoom(mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBeNull();
            expect(wss.getClient(NO_ROOM_KEY, player.playerID)).toBe(mockWS);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toBeNull();

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(
                EventTypes.PLAYER_LEFT_ROOM,
                {roomID: player.currentRoomID, playerID: player.playerID, newHostPlayerID: null}
            ));
        });
    });

    describe('handleJoinGame', () => {
        const eventType = EventTypes.JOIN_GAME;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if game ID missing', async () => {
            const event = new WebsocketEvent(eventType, {context: {roomID: ROOM_ID}});
            const mockWS = getMockWebsocket();
            await wss.handleJoinGame(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'missing game ID', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType, {context: {roomID: ROOM_ID, gameID: GAME_ID}});
        });

        test('sends error response if room not found', async () => {
            await expectRoomNotFoundEvent(wss, eventType, {context: new EventContext(ROOM_ID, GAME_ID, PLAYER_ID)});
        });

        test('sends error response if game not found', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.rooms.create(room);
            await expectGameNotFoundEvent(wss, eventType, {context: new EventContext(room.roomID, GAME_ID, PLAYER_ID)});
        });

        test('sends error response if player not found', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID);
            await db.games.create(game);
            await db.rooms.create(room);
            await expectPlayerNotFoundEvent(wss, eventType, {context: new EventContext(room.roomID, game.gameID, PLAYER_ID)});
        });

        test('sends error response if player not in room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID);
            await db.games.create(game);
            await db.players.create(player);
            await db.rooms.create(room);
            await expectPlayerNotInRoomEvent(wss, eventType, {context: new EventContext(room.roomID, game.gameID, player.playerID)});
        });

        test('sends error response if max players exceeded', async () => {
            const player1 = new Player('Fred');
            const player2 = new Player('Barney');
            const player3 = new Player('Betty');
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID, [player1.playerID, player2.playerID]);
            player1.currentRoomID = room.roomID;
            player2.currentRoomID = room.roomID;
            player3.currentRoomID = room.roomID;
            room.playerIDs = [player1.playerID, player2.playerID, player3.playerID];
            await db.games.create(game);
            await db.players.createMany([player1, player2, player3]);
            await db.rooms.create(room);
            await expectMaxPlayersExceededEvent(wss, eventType, {context: new EventContext(room.roomID, game.gameID, player3.playerID)});
        });

        test.each([
            [true],
            [false],
        ])('success - player joins game (spectating = %p)', async (spectating) => {
            const player = new Player(PLAYER_NAME, null, spectating);
            const room = new Room(ROOM_CODE, player.playerID);
            const game = new Game(room.roomID);
            player.currentRoomID = room.roomID;
            await db.games.create(game);
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {context: new EventContext(room.roomID, game.gameID, player.playerID)});
            const mockWS = getMockWebsocket();
            await wss.handleJoinGame(mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBe(mockWS);

            const newGame = await db.games.getByID(game.gameID);
            expect(newGame.playerIDs).toEqual([player.playerID]);
            expect(newGame.scores[player.playerID]).toEqual(0);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(
                EventTypes.PLAYER_JOINED,
                {roomID: room.roomID, player: {...player, score: 0}},
            ));
        });
    });

    describe('handleStartSpectating', () => {
        const eventType = EventTypes.START_SPECTATING;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType, {roomID: ROOM_ID});
        });

        test('sends error response if player not found', async () => {
            await expectPlayerNotFoundEvent(wss, eventType, {roomID: ROOM_ID, playerID: PLAYER_ID});
        });

        test('sends error response if player not in room', async () => {
            const player = new Player(PLAYER_NAME);
            await db.players.create(player);
            await expectPlayerNotInRoomEvent(wss, eventType, {roomID: ROOM_ID, playerID: player.playerID});
        });

        test('success - player starts spectating', async () => {
            const player = new Player(PLAYER_NAME);
            player.currentRoomID = ROOM_ID;
            await db.players.create(player);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: ROOM_ID, playerID: player.playerID});
            await wss.handleStartSpectating(getMockWebsocket(), event);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.spectating).toBeTruthy();

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_STARTED_SPECTATING, event.payload));
        });
    });

    describe('handleStopSpectating', () => {
        const eventType = EventTypes.STOP_SPECTATING;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType, {roomID: ROOM_ID});
        });

        test('sends error response if player not found', async () => {
            await expectPlayerNotFoundEvent(wss, eventType, {roomID: ROOM_ID, playerID: PLAYER_ID});
        });

        test('sends error response if player not in room', async () => {
            const player = new Player(PLAYER_NAME);
            await db.players.create(player);
            await expectPlayerNotInRoomEvent(wss, eventType, {roomID: ROOM_ID, playerID: player.playerID});
        });

        test('sends error response if game not found', async () => {
            const player = new Player(PLAYER_NAME);
            player.currentRoomID = ROOM_ID;
            await db.players.create(player);
            await expectGameNotFoundEvent(wss, eventType, {roomID: ROOM_ID, gameID: GAME_ID, playerID: player.playerID});
        });

        test('sends error response if player not in game', async () => {
            const game = new Game(ROOM_ID);
            const player = new Player(PLAYER_NAME);
            player.currentRoomID = ROOM_ID;
            await db.games.create(game);
            await db.players.create(player);

            const event = new WebsocketEvent(eventType, {roomID: ROOM_ID, gameID: game.gameID, playerID: player.playerID});
            const mockWS = getMockWebsocket();
            await wss.handleStopSpectating(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'player not in game', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if max players exceeded', async () => {
            const player1 = new Player('Fred');
            const player2 = new Player('Barney');
            const player3 = new Player('Betty');
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const game = new Game(room.roomID, [player1.playerID, player2.playerID, player3.playerID]);
            player1.currentRoomID = room.roomID;
            player2.currentRoomID = room.roomID;
            player3.currentRoomID = room.roomID;
            await db.games.create(game);
            await db.players.createMany([player1, player2, player3]);
            await db.rooms.create(room);
            await expectMaxPlayersExceededEvent(wss, eventType, {roomID: room.roomID, gameID: game.gameID, playerID: player3.playerID});
        });

        test('success - player stops spectating in game', async () => {
            const player = new Player(PLAYER_NAME, null, true);
            const game = new Game(ROOM_ID, [player.playerID]);
            player.currentRoomID = ROOM_ID;
            await db.games.create(game);
            await db.players.create(player);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: ROOM_ID, gameID: game.gameID, playerID: player.playerID});
            const mockWS = getMockWebsocket();
            await wss.handleStopSpectating(mockWS, event);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.spectating).toBeFalsy();

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_STOPPED_SPECTATING, {roomID: ROOM_ID, playerID: player.playerID}));
        });

        test('success - player stops spectating without game (in lobby)', async () => {
            const player = new Player(PLAYER_NAME, null, true);
            player.currentRoomID = ROOM_ID;
            await db.players.create(player);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: ROOM_ID, playerID: player.playerID});
            await wss.handleStopSpectating(getMockWebsocket(), event);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.spectating).toBeFalsy();

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_STOPPED_SPECTATING, event.payload));
        });
    });

    describe('handleAbandonGame', () => {
        const eventType = EventTypes.ABANDON_GAME;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if room not found', async () => {
            await expectRoomNotFoundEvent(wss, eventType, {context: new EventContext(ROOM_ID, GAME_ID, PLAYER_ID)}, `room "${ROOM_ID}" not found`);
        });

        test('sends error response if request does not come from host', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            const game = new Game(room.roomID, [player.playerID]);
            player.currentRoomID = room.roomID;
            room.currentGameID = game.gameID;
            room.hostPlayerID = player.playerID;
            await db.games.create(game);
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {context: new EventContext(room.roomID, game.gameID, player.playerID)});
            const mockWS = getMockWebsocket();
            await wss.handleAbandonGame(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'only the host may abandon games', StatusCodes.FORBIDDEN);
        });

        test('success - host abandons game', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            const game = new Game(room.roomID, [player.playerID]);
            player.currentRoomID = room.roomID;
            room.currentGameID = game.gameID;
            room.hostPlayerID = player.playerID;
            await db.games.create(game);
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {context: new EventContext(room.roomID, game.gameID, player.playerID)});
            const mockWS = getMockWebsocket();
            wss.connectedClients[room.roomID] = {[player.playerID]: mockWS};
            await wss.handleAbandonGame(mockWS, event);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.currentGameID).toBeNull();

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.HOST_ABANDONED_GAME, event.payload));
        });
    });

    describe('handleKickPlayer', () => {
        const eventType = EventTypes.KICK_PLAYER;

        test('sends error response if room ID missing', async () => {
            await expectMissingRoomIDEvent(wss, eventType);
        });

        test('sends error response if player ID missing', async () => {
            await expectMissingPlayerIDEvent(wss, eventType, {roomID: ROOM_ID});
        });

        test('sends error response if room not found', async () => {
            await expectRoomNotFoundEvent(wss, eventType, {roomID: ROOM_ID, playerID: PLAYER_ID});
        });

        test('sends error response if player not found', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.rooms.create(room);
            await expectPlayerNotFoundEvent(wss, eventType, {roomID: room.roomID, playerID: PLAYER_ID});
        });

        test('sends error response if request does not come from host', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {roomID: room.roomID, playerID: player.playerID});
            const mockWS = getMockWebsocket();
            await wss.handleKickPlayer(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'only the host may kick players', StatusCodes.FORBIDDEN);
        });

        test('sends error response if player not in room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.hostPlayerID = PLAYER_ID;
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {roomID: room.roomID, playerID: player.playerID});
            const mockWS = getMockWebsocket();
            wss.connectedClients[room.roomID] = {[PLAYER_ID]: mockWS};
            await wss.handleKickPlayer(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'player not in room', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if player already kicked from room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = room.roomID;
            room.hostPlayerID = PLAYER_ID;
            room.kickedPlayerIDs[player.playerID] = tomorrow();
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {roomID: room.roomID, playerID: player.playerID});
            const mockWS = getMockWebsocket();
            wss.connectedClients[room.roomID] = {[PLAYER_ID]: mockWS};
            await wss.handleKickPlayer(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'player already kicked from room', StatusCodes.BAD_REQUEST);
        });

        test('sends error response if duration invalid', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = room.roomID;
            room.hostPlayerID = PLAYER_ID;
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType, {roomID: room.roomID, playerID: player.playerID, duration: -1});
            const mockWS = getMockWebsocket();
            wss.connectedClients[room.roomID] = {[PLAYER_ID]: mockWS};
            await wss.handleKickPlayer(mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'invalid duration', StatusCodes.BAD_REQUEST);
        });

        test('success - host kicks player from room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = room.roomID;
            room.hostPlayerID = PLAYER_ID;
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType, {roomID: room.roomID, playerID: player.playerID, duration: 60});
            const hostWS = getMockWebsocket();
            const playerWS = getMockWebsocket();
            wss.connectedClients[room.roomID] = {
                [PLAYER_ID]: hostWS,
                [player.playerID]: playerWS,
            };
            await wss.handleKickPlayer(hostWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBeNull();
            expect(wss.getClient(room.roomID, PLAYER_ID)).toBe(hostWS);
            expect(wss.getClient(NO_ROOM_KEY, player.playerID)).toBe(playerWS);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.kickedPlayerIDs[player.playerID]).toBeDefined();

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toBeNull();

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.HOST_KICKED_PLAYER, event.payload));
        });
    });

    describe('removePlayerFromRoom', () => {
        test('success - remove non-host player from room', async () => {
            const room = new Room(ROOM_CODE, PLAYER_ID);
            const player = new Player(PLAYER_NAME);
            player.currentRoomID = room.roomID;
            room.playerIDs = [PLAYER_ID, player.playerID];
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            await wss.removePlayerFromRoom(player, room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([PLAYER_ID]);
            expect(newRoom.hostPlayerID).toEqual(PLAYER_ID);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(
                EventTypes.PLAYER_LEFT_ROOM,
                {roomID: room.roomID, playerID: player.playerID, newHostPlayerID: null},
            ));
        });

        test('success - remove host player from room', async () => {
            const owner = new Player('Owner');
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, owner.playerID);
            owner.currentRoomID = room.roomID;
            player.currentRoomID = room.roomID;
            room.hostPlayerID = player.playerID;
            room.playerIDs = [owner.playerID, player.playerID];
            await db.players.createMany([owner, player]);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            await wss.removePlayerFromRoom(player, room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([owner.playerID]);
            expect(newRoom.hostPlayerID).toEqual(owner.playerID);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(
                EventTypes.PLAYER_LEFT_ROOM,
                {roomID: room.roomID, playerID: player.playerID, newHostPlayerID: owner.playerID},
            ));
        });
    });

    describe('reassignRoomHostIfNecessary', () => {
        test('does nothing if player is not host', async () => {
            const room = new Room(ROOM_CODE, OTHER_PLAYER_ID);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            wss.reassignRoomHostIfNecessary(room.roomID, PLAYER_ID);
            await sleep(SLEEP_DELAY_MILLIS);  // Wait for asynchronous updates
            expect(spy).not.toHaveBeenCalled();
        });

        test('does nothing if host reconnects before reassignment check', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            player.currentRoomID = room.roomID;
            room.hostPlayerID = player.playerID;
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            wss.reassignRoomHostIfNecessary(room.roomID, player.playerID);
            await sleep(SLEEP_DELAY_MILLIS);  // Wait for asynchronous updates
            expect(spy).not.toHaveBeenCalled();
        });

        test('removes player from room and reassigns room host if host goes inactive', async () => {
            const player = new Player(PLAYER_NAME);
            await db.players.create(player);
            const ownerPlayerID = 'owner';
            const room = new Room(ROOM_CODE, ownerPlayerID);
            room.hostPlayerID = player.playerID;
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            wss.reassignRoomHostIfNecessary(room.roomID, player.playerID);
            await sleep(SLEEP_DELAY_MILLIS);  // Wait for asynchronous updates

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.hostPlayerID).toEqual(ownerPlayerID);

            expect(spy).toHaveBeenCalledWith(
                new WebsocketEvent(
                    EventTypes.ROOM_HOST_REASSIGNED,
                    {roomID: room.roomID, newHostPlayerID: ownerPlayerID}
                ),
                player.playerID
            );
        });
    });

    describe('joinRoom', () => {
        const eventType = EventTypes.JOIN_ROOM;

        test('sends error response if player currently kicked from room', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.kickedPlayerIDs[player.playerID] = tomorrow();

            const event = new WebsocketEvent(eventType);
            const mockWS = getMockWebsocket();
            await wss.joinRoom(player, room, mockWS, event);
            expectWebsocketErrorEvent(mockWS, event, 'player was kicked from room', StatusCodes.CONFLICT);
        });

        test('removes player from kicked players in room if expiration is in the past', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, PLAYER_ID);
            room.kickedPlayerIDs[player.playerID] = yesterday();  // Kick expired 1 day ago
            await db.players.create(player);
            await db.rooms.create(room);

            const event = new WebsocketEvent(eventType);
            const mockWS = getMockWebsocket();
            await wss.joinRoom(player, room, mockWS, event);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.kickedPlayerIDs[player.playerID]).not.toBeDefined();
        });

        test('removes player from previous room if present', async () => {
            const player = new Player(PLAYER_NAME);
            const otherRoom = new Room('ROOM', player.playerID);
            const room = new Room(ROOM_CODE, player.playerID);
            player.currentRoomID = otherRoom.roomID;
            await db.players.create(player);
            await db.rooms.createMany([room, otherRoom]);

            const event = new WebsocketEvent(eventType);
            const mockWS = getMockWebsocket();
            await wss.joinRoom(player, room, mockWS, event);

            const newRoom = await db.rooms.getByID(otherRoom.roomID);
            expect(newRoom.playerIDs).not.toContain(player.playerID);
            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.currentRoomID).toEqual(room.roomID);
        });

        test('success - player joins room normally', async () => {
            const player = new Player(PLAYER_NAME);
            const room = new Room(ROOM_CODE, player.playerID);
            room.playerIDs = [];
            await db.players.create(player);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType);
            const mockWS = getMockWebsocket();
            await wss.joinRoom(player, room, mockWS, event);
            expect(wss.getClient(room.roomID, player.playerID)).toBe(mockWS);

            const newPlayer = await db.players.getByID(player.playerID);
            expect(newPlayer.spectating).toBeFalsy();
            expect(newPlayer.currentRoomID).toEqual(room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([player.playerID]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(EventTypes.PLAYER_JOINED_ROOM, {roomID: room.roomID, playerID: player.playerID, players: {[player.playerID]: newPlayer}}));
        });

        test('success - player forced to join as spectator if room is full', async () => {
            const player1 = new Player('Fred');
            const player2 = new Player('Barney');
            const player3 = new Player('Betty');
            const room = new Room(ROOM_CODE, player1.playerID);
            player1.currentRoomID = room.roomID;
            player2.currentRoomID = room.roomID;
            room.playerIDs = [player1.playerID, player2.playerID];
            await db.players.createMany([player1, player2, player3]);
            await db.rooms.create(room);

            const spy = jest.spyOn(wss, 'broadcast');
            const event = new WebsocketEvent(eventType);
            const mockWS = getMockWebsocket();
            await wss.joinRoom(player3, room, mockWS, event);
            expect(wss.getClient(room.roomID, player3.playerID)).toBe(mockWS);

            const newPlayer = await db.players.getByID(player3.playerID);
            expect(newPlayer.spectating).toBeTruthy();
            expect(newPlayer.currentRoomID).toEqual(room.roomID);

            const newRoom = await db.rooms.getByID(room.roomID);
            expect(newRoom.playerIDs).toEqual([player1.playerID, player2.playerID, player3.playerID]);

            expect(spy).toHaveBeenCalledWith(new WebsocketEvent(
                EventTypes.PLAYER_JOINED_ROOM,
                {
                    roomID: room.roomID,
                    playerID: player3.playerID,
                    players: {
                        [player1.playerID]: player1,
                        [player2.playerID]: player2,
                        [player3.playerID]: newPlayer,
                    },
                }
            ));
        });
    });
});
