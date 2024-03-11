import bcrypt from 'bcryptjs';
import log from 'log';
import WebSocket from 'ws';
import {
    EventTypes,
    MAX_KICK_DURATION_SECONDS,
    MILLISECONDS_PER_SECOND,
    PlayerStatsKeys,
    randomIndex,
    rotate,
    StatusCodes,
    WebsocketEvent,
} from '@dyesoft/alea-core';

export const NO_ROOM_KEY = 'NO_ROOM';

const PING_INTERVAL_MILLIS = 30 * MILLISECONDS_PER_SECOND;
const PING_MESSAGE = 'alea-ping';

const REASSIGNMENT_CHECK_DELAY_MILLIS = 5 * MILLISECONDS_PER_SECOND;

const FAILED_TO_GET_PLAYERS_MESSAGE = 'failed to get players';
const GAME_NOT_ACTIVE_IN_ROOM_MESSAGE = 'game not active in room';
const INVALID_DURATION_MESSAGE = 'invalid duration';
const INVALID_PASSWORD_MESSAGE = 'invalid password';
const MAX_PLAYERS_EXCEEDED_MESSAGE = 'max players exceeded';
const PLAYER_NOT_IN_GAME_MESSAGE = 'player not in game';
const PLAYER_NOT_IN_ROOM_MESSAGE = 'player not in room';
const PLAYER_KICKED_FROM_ROOM_MESSAGE = 'player was kicked from room';

const MISSING_GAME_ID_MESSAGE = 'missing game ID';
const MISSING_PLAYER_ID_MESSAGE = 'missing player ID';
const MISSING_ROOM_CODE_MESSAGE = 'missing room code';
const MISSING_ROOM_ID_MESSAGE = 'missing room ID';

const PERMISSION_ABANDON_GAME_MESSAGE = 'only the host may abandon games';
const PERMISSION_KICK_PLAYER_MESSAGE = 'only the host may kick players';

const GAME_NOT_FOUND_MESSAGE = 'game not found';
const PLAYER_NOT_FOUND_MESSAGE = 'player not found';
const ROOM_NOT_FOUND_MESSAGE = 'room not found';

const logger = log.get('ws');

/* Logging adapter that maintains a separate logger instance for each room. */
export class RoomLogger {
    /* Create a RoomLogger using the given database connection to fetch rooms. */
    constructor(db) {
        this.db = db;
        this.loggers = {};
    }

    /*
     * Return a logger instance for the room with the given ID.
     * The logger will be namespaced to the given room's short code
     * (e.g., for a room with short code 'ROOM', the namespace will be 'ws:ROOM').
     */
    getLogger(roomID) {
        if (!this.loggers.hasOwnProperty(roomID)) {
            this.db.rooms.getByID(roomID).then(room => {
                const namespace = (room?.roomCode || roomID).toLowerCase().replaceAll('_', '-');
                this.loggers[roomID] = log.get(`ws:${namespace}`);
            });
        }
        return this.loggers[roomID] || logger;
    }

    /* Log a message at DEBUG level for the given room. */
    debug(roomID, message) {
        this.getLogger(roomID).debug(message);
    }

    /* Log a message at INFO level for the given room. */
    info(roomID, message) {
        this.getLogger(roomID).info(message);
    }

    /* Log a message at ERROR level for the given room. */
    error(roomID, message) {
        this.getLogger(roomID).error(message);
    }
}

/* Server for managing websocket connections and handling websocket events. */
export class WebsocketServer {
    /* Create a WebsocketServer using the given database connection. */
    constructor(db, config = null) {
        this.db = db;
        this.maxPlayersPerGame = config?.maxPlayersPerGame || null;
        this.pingIntervalMillis = config?.pingIntervalMillis ?? PING_INTERVAL_MILLIS;
        this.reassignmentDelayCheckMillis = config?.reassignmentDelayCheckMillis ?? REASSIGNMENT_CHECK_DELAY_MILLIS;
        this.roomLogger = new RoomLogger(db);
        this.connectedClients = {};
        this.pingHandlers = {};
        this.playerNames = {};

        this.eventHandlers = {
            /* connection events */
            [EventTypes.CLIENT_CONNECT]: this.handleClientConnect.bind(this),
            /* game events */
            [EventTypes.GAME_CREATION_FAILED]: this.handleGameCreationFailed.bind(this),
            [EventTypes.GAME_SETTINGS_CHANGED]: this.handleGameSettingsChanged.bind(this),
            /* room events */
            [EventTypes.REASSIGN_ROOM_HOST]: this.handleReassignRoomHost.bind(this),
            /* player events */
            [EventTypes.JOIN_ROOM]: this.handleJoinRoom.bind(this),
            [EventTypes.JOIN_ROOM_WITH_CODE]: this.handleJoinRoomWithCode.bind(this),
            [EventTypes.LEAVE_ROOM]: this.handleLeaveRoom.bind(this),
            [EventTypes.JOIN_GAME]: this.handleJoinGame.bind(this),
            [EventTypes.START_SPECTATING]: this.handleStartSpectating.bind(this),
            [EventTypes.STOP_SPECTATING]: this.handleStopSpectating.bind(this),
            /* host-only events */
            [EventTypes.ABANDON_GAME]: this.handleAbandonGame.bind(this),
            [EventTypes.KICK_PLAYER]: this.handleKickPlayer.bind(this),
        };
    }

    /* Associate the given websocket client connection with the given room ID and player ID. */
    addClient(roomID, playerID, ws) {
        if (!this.connectedClients.hasOwnProperty(roomID)) {
            this.connectedClients[roomID] = {};
        }
        this.connectedClients[roomID][playerID] = ws;
        if (roomID !== NO_ROOM_KEY) {
            this.removeClient(NO_ROOM_KEY, playerID);
        }
    }

    /* Remove the websocket client connection associated with the given room ID and player ID, if any. */
    removeClient(roomID, playerID) {
        let client = null;
        if (this.connectedClients.hasOwnProperty(roomID)) {
            client = this.connectedClients[roomID][playerID];
            delete this.connectedClients[roomID][playerID];
            if (!Object.keys(this.connectedClients[roomID]).length) {
                delete this.connectedClients[roomID];
            }
        }
        return client;
    }

    /*
     * Return all websocket client connections for the given room ID.
     * The return value is an object with player IDs as keys and websockets as values.
     */
    getClients(roomID) {
        return this.connectedClients[roomID] || {};
    }

    /* Return the websocket client connection for the given room ID and player ID, or null if there is none. */
    getClient(roomID, playerID) {
        const clients = this.getClients(roomID);
        return clients[playerID] || null;
    }

    /* Return the cached name of the player with the given ID, or the ID itself if the name is not cached. */
    getPlayerName(playerID) {
        return this.playerNames[playerID] || playerID;
    }

    /*
     * Broadcast the given event to all clients connected to the room given in the event payload.
     * If originatingPlayerID is provided, the event is not sent to that player's websocket.
     */
    broadcast(event, originatingPlayerID) {
        const roomID = event.payload?.context?.roomID || event.payload?.roomID;
        if (!roomID) {
            logger.error(`Unknown room ID for ${event.eventType} event; skipping broadcast.`);
            return;
        }
        this.roomLogger.debug(roomID, `Broadcasting ${event.eventType} event...`);

        let jsonEvent;
        const clients = Object.entries(this.getClients(roomID));
        // Rotate array to randomize order in which clients receive events (to ensure fairness).
        rotate(clients, randomIndex(clients)).forEach(([playerID, ws]) => {
            if (!originatingPlayerID || playerID !== originatingPlayerID) {
                if (!jsonEvent) {
                    jsonEvent = JSON.stringify(event);
                }
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(jsonEvent);
                    }
                } catch (e) {
                    this.roomLogger.error(roomID, `Failed to send ${event.eventType} event to player ${playerID}: ${e}`);
                }
            }
        });
    }

    /*
     * Handler for all websocket events. Handles message, ping, pong, and close events.
     * Delegates to specific event handlers for known event types.
     */
    handleWebsocket(ws, req) {
        ws.on('message', async (msg) => {
            let event;
            try {
                event = JSON.parse(msg);
            } catch (e) {
                logger.error(`Failed to parse message "${msg}" as JSON: ${e}`);
                return;
            }
            const eventType = event.eventType;
            if (this.eventHandlers.hasOwnProperty(eventType)) {
                const handler = this.eventHandlers[eventType];
                try {
                    await handler(ws, event);
                } catch (e) {
                    logger.error(`Caught unexpected error while handling ${eventType} event: ${e}`);
                    if (ws.readyState === WebSocket.OPEN) {
                        const payload = {eventType: eventType, error: e.message, status: StatusCodes.INTERNAL_SERVER_ERROR};
                        ws.send(JSON.stringify(new WebsocketEvent(EventTypes.ERROR, payload)));
                    }
                }
            } else {
                logger.info(`Ignoring event with unknown type: ${eventType} (${msg})`);
            }
        });

        ws.on('ping', (data) => {
            logger.debug(`Received ping from client: ${data}`);
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.pong(data);
                }
            } catch (e) {
                logger.error(`Caught unexpected error while sending pong to client: ${e}`);
            }
        });

        ws.on('pong', (data) => {
            logger.debug(`Received pong from client: ${data}`);
        });

        ws.on('close', (code, reason) => {
            logger.debug(`Websocket closed: ${reason} (${code})`);
            if (this.pingHandlers.hasOwnProperty(ws)) {
                logger.debug('Removing ping handler.');
                const interval = this.pingHandlers[ws];
                clearInterval(interval);
                delete this.pingHandlers[ws];
            } else {
                logger.debug('Ping handler not found; skipping.');
            }
            Object.entries(this.connectedClients).forEach(([roomID, clients]) => {
                Object.entries(clients).forEach(([playerID, socket]) => {
                    if (socket === ws) {
                        this.db.players.updateByID(playerID, {active: false, currentRoomID: null}).then(() => {
                            this.roomLogger.info(roomID, `${this.getPlayerName(playerID)} went inactive.`);
                            const payload = {roomID: roomID, playerID: playerID};
                            this.broadcast(new WebsocketEvent(EventTypes.PLAYER_WENT_INACTIVE, payload));
                            this.removeClient(roomID, playerID);
                            this.reassignRoomHostIfNecessary(roomID, playerID);
                        }).catch(e => this.roomLogger.error(roomID, `Failed to mark player ${playerID} as inactive: ${e}`));
                    }
                });
            });
        });
    }

    /*
     * Handle an error that occurred while attempting to process a websocket event.
     * The error is logged and sent to the originating client websocket as an ERROR event.
     */
    handleError(ws, event, message, status) {
        logger.error(`Error handling ${event.eventType} event: ${message} (${status})`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(new WebsocketEvent(EventTypes.ERROR, {eventType: event.eventType, error: message, status: status})));
        }
    }

    /*
     * Validate the game ID provided in the payload of a websocket event.
     * If the game ID is valid and the game exists in the database, the game entity from the database is returned.
     * If the game ID is invalid, an ERROR event is sent to the client, and null is returned.
     */
    async validateGameByID(ws, event, gameID) {
        if (!gameID) {
            this.handleError(ws, event, MISSING_GAME_ID_MESSAGE, StatusCodes.BAD_REQUEST);
            return null;
        }

        const game = await this.db.games.getByID(gameID);
        if (!game) {
            this.handleError(ws, event, GAME_NOT_FOUND_MESSAGE, StatusCodes.NOT_FOUND);
        }
        return game;
    }

    /*
     * Validate the player ID provided in the payload of a websocket event.
     * If the player ID is valid and the player exists in the database, the player entity from the database is returned.
     * If the player ID is invalid, an ERROR event is sent to the client, and null is returned.
     */
    async validatePlayerByID(ws, event, playerID) {
        if (!playerID) {
            this.handleError(ws, event, MISSING_PLAYER_ID_MESSAGE, StatusCodes.BAD_REQUEST);
            return null;
        }

        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, PLAYER_NOT_FOUND_MESSAGE, StatusCodes.NOT_FOUND);
        }
        return player;
    }

    /*
     * Validate the room code provided in the payload of a websocket event.
     * If the room code is valid and the room exists in the database, the room entity from the database is returned.
     * If the room code is invalid, an ERROR event is sent to the client, and null is returned.
     */
    async validateRoomByCode(ws, event, roomCode) {
        if (!roomCode) {
            this.handleError(ws, event, MISSING_ROOM_CODE_MESSAGE, StatusCodes.BAD_REQUEST);
            return null;
        }

        const room = await this.db.rooms.getByRoomCode(roomCode);
        if (!room) {
            this.handleError(ws, event, ROOM_NOT_FOUND_MESSAGE, StatusCodes.NOT_FOUND);
        }
        return room;
    }

    /*
     * Validate the room ID provided in the payload of a websocket event.
     * If the room ID is valid and the room exists in the database, the room entity from the database is returned.
     * If the room ID is invalid, an ERROR event is sent to the client, and null is returned.
     */
    async validateRoomByID(ws, event, roomID) {
        if (!roomID) {
            this.handleError(ws, event, MISSING_ROOM_ID_MESSAGE, StatusCodes.BAD_REQUEST);
            return null;
        }

        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, ROOM_NOT_FOUND_MESSAGE, StatusCodes.NOT_FOUND);
        }
        return room;
    }

    /*
     * Validate the player and room IDs provided in the payload of a websocket event.
     * If the IDs are valid and the player AND room exist, an object is returned containing the player and room entities from the database.
     * If the IDs are invalid, an ERROR event is sent to the client, and the returned object will have the player and room set to null.
     */
    async validatePlayerAndRoomByID(ws, event, playerID, roomID, checkPlayerInRoom = false) {
        const errorResult = {player: null, room: null};
        const player = await this.validatePlayerByID(ws, event, playerID);
        if (!player) {
            return errorResult;
        }

        const room = await this.validateRoomByID(ws, event, roomID);
        if (!room) {
            return errorResult;
        }

        if (checkPlayerInRoom && (!room.playerIDs.includes(playerID) || player.currentRoomID !== roomID)) {
            this.handleError(ws, event, PLAYER_NOT_IN_ROOM_MESSAGE, StatusCodes.BAD_REQUEST);
            return errorResult;
        }

        return {player, room};
    }

    /*
     * Validate the context field of a websocket event's payload (or the payload itself if the context field is not present).
     * The context must contain a valid player ID and room ID, as is the case for most room-based websocket events.
     * If the context is valid, an object is returned containing the player and room entities from the database.
     * If the context is invalid, an ERROR event is sent to the client, and the returned object will have its fields set to null.
     */
    async validateRoomEventContext(ws, event, checkPlayerInRoom = false) {
        const { playerID, roomID } = event.payload?.context || event.payload || {};
        return await this.validatePlayerAndRoomByID(ws, event, playerID, roomID, checkPlayerInRoom);
    }

    /*
     * Validate the context field of a websocket event's payload (or the payload itself if the context field is not present).
     * The context must contain a valid player ID, room ID, and game ID, as is the case for most game-based websocket events.
     * If the context is valid, an object is returned containing the player, room, and game entities from the database.
     * If the context is invalid, an ERROR event is sent to the client, and the returned object will have its fields set to null.
     */
    async validateGameEventContext(ws, event, checkPlayerInRoom = false, checkPlayerInGame = true) {
        const errorResult = {game: null, player: null, room: null};
        const { player, room } = await this.validateRoomEventContext(ws, event, checkPlayerInRoom);
        if (!player) {
            return errorResult;
        }

        const { gameID } = event.payload?.context || event.payload || {};
        const game = await this.validateGameByID(ws, event, gameID);
        if (!game) {
            return errorResult;
        }

        if (room.currentGameID !== gameID || game.roomID !== room.roomID) {
            this.handleError(ws, event, GAME_NOT_ACTIVE_IN_ROOM_MESSAGE, StatusCodes.BAD_REQUEST);
            return errorResult;
        }

        if (checkPlayerInGame && !game.playerIDs.includes(player.playerID)) {
            this.handleError(ws, event, PLAYER_NOT_IN_GAME_MESSAGE, StatusCodes.BAD_REQUEST);
            return errorResult;
        }

        return {game, player, room};
    }

    /*
     * Validate that the configured player limit has not been exceeded for the given game.
     * If the game is valid with respect to the player limit, true is returned.
     * If the player limit has been exceeded, an ERROR event is sent to the client, and false is returned.
     */
    async validatePlayerLimitForGame(ws, event, game) {
        let players;
        try {
            players = await this.db.players.getByIDs(game.playerIDs);
        } catch (e) {
            this.roomLogger.error(game.roomID, `Failed to get players in game ${game.gameID}: ${e}`);
            this.handleError(ws, event, FAILED_TO_GET_PLAYERS_MESSAGE, StatusCodes.INTERNAL_SERVER_ERROR);
            return false;
        }
        const numPlayers = players.filter(player => player.active && player.currentRoomID === game.roomID && !player.spectating).length;
        if (this.maxPlayersPerGame && this.maxPlayersPerGame > 0 && numPlayers >= this.maxPlayersPerGame) {
            this.handleError(ws, event, MAX_PLAYERS_EXCEEDED_MESSAGE, StatusCodes.BAD_REQUEST);
            return false;
        }
        return true;
    }

    /* Fetch all players in the given room (plus the given player) and return an object mapping player IDs to player entities. */
    async getAllPlayersInRoom(ws, event, player, room) {
        let players;
        try {
            players = await this.db.players.getByIDs(room.playerIDs);
        } catch (e) {
            this.roomLogger.error(room.roomID, `Failed to get players in room: ${e}`);
            this.handleError(ws, event, FAILED_TO_GET_PLAYERS_MESSAGE, StatusCodes.INTERNAL_SERVER_ERROR);
            return null;
        }
        let newPlayers = {[player.playerID]: player};
        players.forEach(player => {
            if (player.currentRoomID === room.roomID) {
                newPlayers[player.playerID] = player;
            }
        });
        return newPlayers;
    }

    /* Handler for CLIENT_CONNECT events. */
    async handleClientConnect(ws, event) {
        let { playerID, roomID } = event.payload || {};

        const player = await this.validatePlayerByID(ws, event, playerID);
        if (!player) {
            return;
        }

        let room;
        if (roomID) {
            room = await this.db.rooms.getByID(roomID);
            if (!room) {
                this.handleError(ws, event, ROOM_NOT_FOUND_MESSAGE, StatusCodes.NOT_FOUND);
                return;
            }
            if (room.kickedPlayerIDs.hasOwnProperty(playerID)) {
                const expiration = room.kickedPlayerIDs[playerID];
                if ((expiration === null || Date.now() < expiration) && playerID !== room.ownerPlayerID) {
                    this.handleError(ws, event, PLAYER_KICKED_FROM_ROOM_MESSAGE, StatusCodes.CONFLICT);
                    return;
                }
                this.roomLogger.info(roomID, `Removing ${this.getPlayerName(playerID)} from kicked players.`);
                await this.db.rooms.removePlayerFromKickedPlayersInRoom(roomID, playerID);
            }
        } else {
            roomID = NO_ROOM_KEY;
        }

        let playerUpdates = {active: true, lastConnectionTime: new Date()};
        if (room && player.currentRoomID !== room.roomID) {
            playerUpdates.currentRoomID = room.roomID;
            if (player.currentRoomID) {
                await this.removePlayerFromRoom(player);
            }
        }
        await this.db.players.updateByID(playerID, playerUpdates);
        if (room && !room.playerIDs.includes(playerID)) {
            await this.db.rooms.addPlayerToRoom(room.roomID, playerID);
        }

        this.roomLogger.info(roomID, `${player.name} connected.`);
        this.addClient(roomID, playerID, ws);
        this.playerNames[playerID] = player.name;

        this.pingHandlers[ws] = setInterval(() => {
            logger.debug(`Pinging websocket for ${this.getPlayerName(playerID)}...`);
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping(PING_MESSAGE);
                }
            } catch (e) {
                logger.error(`Unexpected error while pinging websocket: ${e}`);
            }
        }, this.pingIntervalMillis);

        if (room) {
            const players = await this.getAllPlayersInRoom(ws, event, player, room);
            if (!players) {
                return;
            }
            this.broadcast(new WebsocketEvent(EventTypes.PLAYER_WENT_ACTIVE, {roomID: room.roomID, playerID: playerID, players: players}));
        }
    }

    /* Handler for GAME_CREATION_FAILED events. */
    async handleGameCreationFailed(ws, event) {
        this.roomLogger.info(event.payload.roomID, 'New game creation failed.');
        this.broadcast(event);
    }

    /* Handler for GAME_SETTINGS_CHANGED events. */
    async handleGameSettingsChanged(ws, event) {
        this.roomLogger.info(event.payload.roomID, 'Game settings changed.');
        this.broadcast(event);
    }

    /* Handler for REASSIGN_ROOM_HOST events. */
    async handleReassignRoomHost(ws, event) {
        const { newHostPlayerID, roomID } = event.payload || {};
        const { player, room } = await this.validatePlayerAndRoomByID(ws, event, newHostPlayerID, roomID, true);
        if (!player) {
            return;
        }
        if (room.hostPlayerID !== newHostPlayerID) {
            await this.db.rooms.updateByID(roomID, {hostPlayerID: newHostPlayerID});
            this.roomLogger.info(roomID, `Reassigning host to ${this.getPlayerName(newHostPlayerID)}.`);
            this.broadcast(new WebsocketEvent(EventTypes.ROOM_HOST_REASSIGNED, event.payload));
        }
    }

    /* Handler for JOIN_ROOM events. */
    async handleJoinRoom(ws, event) {
        const { player, room } = await this.validateRoomEventContext(ws, event);
        if (!player) {
            return;
        }
        if (room.passwordHash && player.currentRoomID !== room.roomID) {
            /* Require player to already be in the room if the room is password-protected. */
            this.handleError(ws, event, PLAYER_NOT_IN_ROOM_MESSAGE, StatusCodes.BAD_REQUEST);
            return;
        }
        await this.joinRoom(player, room, ws, event);
    }

    /* Handler for JOIN_ROOM_WITH_CODE events. */
    async handleJoinRoomWithCode(ws, event) {
        const { password, playerID, roomCode } = event.payload || {};
        const player = await this.validatePlayerByID(ws, event, playerID);
        if (!player) {
            return;
        }
        const room = await this.validateRoomByCode(ws, event, roomCode);
        if (!room) {
            return;
        }
        if (room.passwordHash && !bcrypt.compareSync(password || '', room.passwordHash)) {
            this.handleError(ws, event, INVALID_PASSWORD_MESSAGE, StatusCodes.UNAUTHORIZED);
            return;
        }
        if (!event.payload.roomID) {
            event.payload.roomID = room.roomID;
        }
        await this.joinRoom(player, room, ws, event);
    }

    /* Handler for LEAVE_ROOM events. */
    async handleLeaveRoom(ws, event) {
        const { player, room } = await this.validateRoomEventContext(ws, event, true);
        if (!player) {
            return;
        }
        try {
            await this.removePlayerFromRoom(player);
            await this.db.players.updateByID(player.playerID, {currentRoomID: null});
        } catch (e) {
            this.roomLogger.error(room.roomID, `Error occurred while removing player ${player.playerID} from room: ${e}`);
            return;
        }
        this.roomLogger.info(room.roomID, `${this.getPlayerName(player.playerID)} left room.`);
        this.removeClient(room.roomID, player.playerID);
        this.addClient(NO_ROOM_KEY, player.playerID, ws);
    }

    /* Handler for JOIN_GAME events. */
    async handleJoinGame(ws, event) {
        const { game, player, room } = await this.validateGameEventContext(ws, event, true, false);
        if (!game) {
            return;
        }
        if (!player.spectating) {
            if (!await this.validatePlayerLimitForGame(ws, event, game)) {
                return;
            }
        }
        try {
            await this.db.games.addPlayerToGame(game.gameID, player.playerID);
        } catch (e) {
            this.roomLogger.error(room.roomID, `Failed to add player ${player.playerID} to game ${game.gameID}: ${e}`);
            return;
        }
        this.roomLogger.info(room.roomID, `${player.name} joined game ${game.gameID}.`);
        this.addClient(room.roomID, player.playerID, ws);
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_JOINED, {roomID: room.roomID, player: {...player, score: game.scores[player.playerID] || 0}}));
        if (!game.playerIDs.includes(player.playerID)) {
            await this.db.players.incrementStat(player.playerID, PlayerStatsKeys.GAMES_PLAYED);
        }
    }

    /* Handler for START_SPECTATING events. */
    async handleStartSpectating(ws, event) {
        const { player, room } = await this.validateRoomEventContext(ws, event, true);
        if (!player) {
            return;
        }
        try {
            await this.db.players.updateByID(player.playerID, {spectating: true});
        } catch (e) {
            this.roomLogger.error(room.roomID, `Failed to start spectating for player ${player.playerID}: ${e}`);
            return;
        }
        this.roomLogger.info(room.roomID, `${this.getPlayerName(player.playerID)} started spectating.`);
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_STARTED_SPECTATING, event.payload));
    }

    /* Handler for STOP_SPECTATING events. */
    async handleStopSpectating(ws, event) {
        const { player, room } = await this.validateRoomEventContext(ws, event, true);
        if (!player) {
            return;
        }
        if (event.payload?.gameID) {
            const game = await this.db.games.getByID(event.payload.gameID);
            if (!game) {
                this.handleError(ws, event, GAME_NOT_FOUND_MESSAGE, StatusCodes.NOT_FOUND);
                return;
            }
            if (!game.playerIDs.includes(player.playerID)) {
                this.handleError(ws, event, PLAYER_NOT_IN_GAME_MESSAGE, StatusCodes.BAD_REQUEST);
                return;
            }
            if (!await this.validatePlayerLimitForGame(ws, event, game)) {
                return;
            }
        }
        try {
            await this.db.players.updateByID(player.playerID, {spectating: false});
        } catch (e) {
            this.roomLogger.error(room.roomID, `Failed to stop spectating for ${player.playerID}: ${e}`);
            return;
        }
        this.roomLogger.info(room.roomID, `${this.getPlayerName(player.playerID)} stopped spectating.`);
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_STOPPED_SPECTATING, {roomID: room.roomID, playerID: player.playerID}));
    }

    /* Handler for ABANDON_GAME events. */
    async handleAbandonGame(ws, event) {
        const { game, room } = await this.validateGameEventContext(ws, event, false, false);
        if (!room) {
            return;
        }
        const hostWS = this.getClient(room.roomID, room.hostPlayerID);
        if (!hostWS || ws !== hostWS) {
            this.handleError(ws, event, PERMISSION_ABANDON_GAME_MESSAGE, StatusCodes.FORBIDDEN);
            return;
        }
        try {
            await this.db.rooms.setCurrentGameForRoom(room, null);
        } catch (e) {
            this.roomLogger.error(room.roomID, `Failed to abandon game: ${e}`);
            return;
        }
        this.roomLogger.info(room.roomID, `Host abandoned game ${game.gameID}.`);
        this.broadcast(new WebsocketEvent(EventTypes.HOST_ABANDONED_GAME, event.payload));
    }

    /* Handler for KICK_PLAYER events. */
    async handleKickPlayer(ws, event) {
        const { player, room } = await this.validateRoomEventContext(ws, event, true);
        if (!player) {
            return;
        }
        if (room.kickedPlayerIDs.hasOwnProperty(player.playerID)) {
            this.handleError(ws, event, PLAYER_KICKED_FROM_ROOM_MESSAGE, StatusCodes.BAD_REQUEST);
            return;
        }
        const hostWS = this.getClient(room.roomID, room.hostPlayerID);
        if (!hostWS || ws !== hostWS) {
            this.handleError(ws, event, PERMISSION_KICK_PLAYER_MESSAGE, StatusCodes.FORBIDDEN);
            return;
        }
        let expiration = null;
        let durationInSeconds = parseInt(event.payload?.duration);
        if (isNaN(durationInSeconds) || durationInSeconds < 0 || durationInSeconds > MAX_KICK_DURATION_SECONDS) {
            this.handleError(ws, event, INVALID_DURATION_MESSAGE, StatusCodes.BAD_REQUEST);
            return;
        }
        if (durationInSeconds > 0) {
            expiration = Date.now() + (durationInSeconds * 1000);
        }
        try {
            await this.db.rooms.updateByID(room.roomID, {[`kickedPlayerIDs.${player.playerID}`]: expiration});
            await this.db.players.updateByID(player.playerID, {currentRoomID: null});
        } catch (e) {
            this.roomLogger.error(room.roomID, `Failed to kick player ${player.playerID}: ${e}`);
            return;
        }
        this.roomLogger.info(room.roomID, `Host kicked ${this.getPlayerName(player.playerID)} ${expiration === null ? 'indefinitely' : 'until ' + new Date(expiration).toLocaleString()}.`);
        /* NOTE: order matters here - need to broadcast before removing the player's websocket from the room */
        this.broadcast(new WebsocketEvent(EventTypes.HOST_KICKED_PLAYER, event.payload));
        const playerWS = this.removeClient(room.roomID, player.playerID);
        if (playerWS) {
            this.addClient(NO_ROOM_KEY, player.playerID, playerWS);
        }
    }

    /*
     * Remove the given player from the given room (or the player's current room if room ID is not provided).
     * The room's host player will be reassigned if the given player is currently the host.
     */
    async removePlayerFromRoom(player, roomID) {
        const newHostPlayerID = await this.db.removePlayerFromRoom(player, roomID);
        if (newHostPlayerID) {
            this.roomLogger.info(roomID || player.currentRoomID, `Reassigning host to ${this.getPlayerName(newHostPlayerID)}.`);
        }
        const payload = {roomID: player.currentRoomID, playerID: player.playerID, newHostPlayerID: newHostPlayerID};
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_LEFT_ROOM, payload));
    }

    /*
     * After a delay, check if the given player is the host of the given room and is no longer in the room.
     * If so, reassign the room's host player if there are any other suitable players in the room.
     * This is used when a client websocket is closed to reassign the host if the client does not reconnect within the delay period.
     */
    reassignRoomHostIfNecessary(roomID, playerID) {
        setTimeout(async () => {
            const room = await this.db.rooms.getByID(roomID);
            if (room.hostPlayerID === playerID) {
                const player = await this.db.players.getByID(playerID);
                if (player.currentRoomID && player.currentRoomID !== roomID) {
                    await this.removePlayerFromRoom(player, roomID);
                } else if (!player.active || !player.currentRoomID) {
                    const newHostPlayerID = await this.db.findNewHostPlayerID(room);
                    if (newHostPlayerID) {
                        this.roomLogger.info(roomID, `Reassigning host to ${this.getPlayerName(newHostPlayerID)}.`);
                        await this.db.rooms.updateByID(roomID, {hostPlayerID: newHostPlayerID});
                        const payload = {roomID: roomID, newHostPlayerID: newHostPlayerID};
                        this.broadcast(new WebsocketEvent(EventTypes.ROOM_HOST_REASSIGNED, payload), playerID);
                    }
                }
            }
        }, this.reassignmentDelayCheckMillis);
    }

    /* Validate and process a request for the given player to join the given room. */
    async joinRoom(player, room, ws, event) {
        if (room.kickedPlayerIDs.hasOwnProperty(player.playerID)) {
            const expiration = room.kickedPlayerIDs[player.playerID];
            if ((expiration === null || Date.now() < expiration) && player.playerID !== room.ownerPlayerID) {
                this.handleError(ws, event, PLAYER_KICKED_FROM_ROOM_MESSAGE, StatusCodes.CONFLICT);
                return;
            }
            this.roomLogger.info(room.roomID, `Removing ${this.getPlayerName(player.playerID)} from kicked players.`);
            await this.db.rooms.removePlayerFromKickedPlayersInRoom(room.roomID, player.playerID);
        }
        if (player.currentRoomID !== room.roomID) {
            await this.db.players.updateByID(player.playerID, {currentRoomID: room.roomID});
            if (player.currentRoomID) {
                await this.removePlayerFromRoom(player);
            }
        }
        if (!room.playerIDs.includes(player.playerID)) {
            room.playerIDs.push(player.playerID);
            await this.db.rooms.addPlayerToRoom(room.roomID, player.playerID);
        }
        this.roomLogger.info(room.roomID, `${player.name} joined room.`);
        this.addClient(room.roomID, player.playerID, ws);
        if (player.currentRoomID && player.currentRoomID !== room.roomID) {
            this.removeClient(player.currentRoomID, player.playerID);
        }
        let players = await this.getAllPlayersInRoom(ws, event, player, room);
        if (!players) {
            return;
        }
        if (!player.spectating && this.maxPlayersPerGame && this.maxPlayersPerGame > 0 &&
                Object.values(players).filter(player => player.active && !player.spectating).length > this.maxPlayersPerGame) {
            this.roomLogger.info(room.roomID, `Room is full. ${player.name} is becoming a spectator.`);
            await this.db.players.updateByID(player.playerID, {spectating: true});
            players[player.playerID].spectating = true;
        }
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_JOINED_ROOM, {roomID: room.roomID, playerID: player.playerID, players: players}));
    }
}
