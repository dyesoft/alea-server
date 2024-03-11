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
     * Validate the context field of a websocket event's payload.
     * The context must contain a valid room ID, game ID, and player ID.
     * If the context is valid, an object is returned containing the game and room entities from the database.
     * If the context is invalid, an ERROR event will be sent to the client, and the returned object will have the game and room set to null.
     */
    async validateEventContext(ws, event) {
        const errorResult = {game: null, room: null};
        const { roomID, gameID, playerID } = event.payload?.context || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return errorResult;
        }
        if (!gameID) {
            this.handleError(ws, event, 'missing game ID', StatusCodes.BAD_REQUEST);
            return errorResult;
        }
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return errorResult;
        }
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, `room "${roomID}" not found`, StatusCodes.NOT_FOUND);
            return errorResult;
        }
        const game = await this.db.games.getByID(gameID);
        if (!game) {
            this.handleError(ws, event, `game "${gameID}" not found`, StatusCodes.NOT_FOUND);
            return errorResult;
        }
        if (room.currentGameID !== gameID || game.roomID !== roomID) {
            this.handleError(ws, event, `game ${gameID} is not active in room ${roomID}`, StatusCodes.BAD_REQUEST);
            return errorResult;
        }
        if (!game.playerIDs.includes(playerID)) {
            this.handleError(ws, event, `player ${playerID} is not in game ${gameID}`, StatusCodes.BAD_REQUEST);
            return errorResult;
        }
        return {game, room};
    }

    /* Handler for CLIENT_CONNECT events. */
    async handleClientConnect(ws, event) {
        let { playerID, roomID } = event.payload || {};
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }

        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }

        let room;
        if (roomID) {
            room = await this.db.rooms.getByID(roomID);
            if (!room) {
                this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
                return;
            }
            if (room.kickedPlayerIDs.hasOwnProperty(playerID)) {
                const expiration = room.kickedPlayerIDs[playerID];
                if ((expiration === null || Date.now() < expiration) && playerID !== room.ownerPlayerID) {
                    this.handleError(ws, event, 'player was kicked from room', StatusCodes.CONFLICT);
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
            let players;
            try {
                players = await this.db.players.getByIDs(room.playerIDs);
            } catch (e) {
                this.handleError(ws, event, 'failed to get players in room', StatusCodes.INTERNAL_SERVER_ERROR);
                return;
            }
            let newPlayers = {[player.playerID]: player};
            players.forEach(player => {
                if (player.currentRoomID === room.roomID) {
                    newPlayers[player.playerID] = player;
                }
            });
            this.broadcast(new WebsocketEvent(EventTypes.PLAYER_WENT_ACTIVE, {roomID: room.roomID, playerID: playerID, players: newPlayers}));
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
        const { roomID, newHostPlayerID } = event.payload || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!newHostPlayerID) {
            this.handleError(ws, event, 'missing new host player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
            return;
        }
        const player = await this.db.players.getByID(newHostPlayerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (!room.playerIDs.includes(newHostPlayerID) || player.currentRoomID !== roomID) {
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
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
        const { playerID, roomID } = event.payload || {};
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (room.passwordHash && player.currentRoomID !== room.roomID) {
            /* require player to already be in the room if the room is password-protected */
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
            return;
        }
        await this.joinRoom(player, room, ws, event);
    }

    /* Handler for JOIN_ROOM_WITH_CODE events. */
    async handleJoinRoomWithCode(ws, event) {
        const { playerID, roomCode, password } = event.payload || {};
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!roomCode) {
            this.handleError(ws, event, 'missing room code', StatusCodes.BAD_REQUEST);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        const room = await this.db.rooms.getByRoomCode(roomCode);
        if (!room) {
            this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (room.passwordHash && !bcrypt.compareSync(password || '', room.passwordHash)) {
            this.handleError(ws, event, 'invalid password', StatusCodes.UNAUTHORIZED);
            return;
        }
        if (!event.payload.roomID) {
            event.payload.roomID = room.roomID;
        }
        await this.joinRoom(player, room, ws, event);
    }

    /* Handler for LEAVE_ROOM events. */
    async handleLeaveRoom(ws, event) {
        const { roomID, playerID } = event.payload || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (!room.playerIDs.includes(playerID) || player.currentRoomID !== roomID) {
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
            return;
        }
        try {
            await this.removePlayerFromRoom(player);
            await this.db.players.updateByID(playerID, {currentRoomID: null});
        } catch (e) {
            this.roomLogger.error(roomID, `Error occurred while removing player ${playerID} from room: ${e}`);
            return;
        }
        this.roomLogger.info(roomID, `${this.getPlayerName(playerID)} left room.`);
        this.removeClient(roomID, playerID);
        this.addClient(NO_ROOM_KEY, playerID, ws);
    }

    /* Handler for JOIN_GAME events. */
    async handleJoinGame(ws, event) {
        const { roomID, gameID, playerID } = event.payload?.context || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!gameID) {
            this.handleError(ws, event, 'missing game ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
            return;
        }
        const game = await this.db.games.getByID(gameID);
        if (!game) {
            this.handleError(ws, event, 'game not found', StatusCodes.NOT_FOUND);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (!room.playerIDs.includes(playerID) || player.currentRoomID !== roomID) {
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!player.spectating) {
            let players;
            try {
                players = await this.db.players.getByIDs(game.playerIDs);
            } catch (e) {
                this.handleError('failed to get players', StatusCodes.INTERNAL_SERVER_ERROR);
                return;
            }
            const numPlayers = players.filter(player => player.active && player.currentRoomID === roomID && !player.spectating).length;
            if (this.maxPlayersPerGame && this.maxPlayersPerGame > 0 && numPlayers >= this.maxPlayersPerGame) {
                this.handleError(ws, event, 'max players exceeded', StatusCodes.BAD_REQUEST);
                return;
            }
        }
        try {
            await this.db.games.addPlayerToGame(gameID, playerID);
        } catch (e) {
            this.roomLogger.error(roomID, `Failed to add player ${playerID} to game ${gameID}: ${e}`);
            return;
        }
        this.roomLogger.info(roomID, `${player.name} joined game ${gameID}.`);
        this.addClient(roomID, playerID, ws);
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_JOINED, {roomID: roomID, player: {...player, score: game.scores[playerID] || 0}}));
        if (!game.playerIDs.includes(playerID)) {
            await this.db.players.incrementStat(playerID, PlayerStatsKeys.GAMES_PLAYED);
        }
    }

    /* Handler for START_SPECTATING events. */
    async handleStartSpectating(ws, event) {
        const { roomID, playerID } = event.payload || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (player.currentRoomID !== roomID) {
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
            return;
        }
        try {
            await this.db.players.updateByID(playerID, {spectating: true});
        } catch (e) {
            this.roomLogger.error(roomID, `Failed to start spectating for ${playerID}: ${e}`);
            return;
        }
        this.roomLogger.info(roomID, `${this.getPlayerName(playerID)} started spectating.`);
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_STARTED_SPECTATING, event.payload));
    }

    /* Handler for STOP_SPECTATING events. */
    async handleStopSpectating(ws, event) {
        const { roomID, gameID, playerID } = event.payload || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        if (player.currentRoomID !== roomID) {
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
            return;
        }
        if (gameID) {
            const game = await this.db.games.getByID(gameID);
            if (!game) {
                this.handleError(ws, event, 'game not found', StatusCodes.NOT_FOUND);
                return;
            }
            if (!game.playerIDs.includes(playerID)) {
                this.handleError(ws, event, 'player not in game', StatusCodes.BAD_REQUEST);
                return;
            }
            let players;
            try {
                players = await this.db.players.getByIDs(game.playerIDs);
            } catch (e) {
                this.handleError(ws, event, 'failed to get players', StatusCodes.INTERNAL_SERVER_ERROR);
                return;
            }
            const numPlayers = players.filter(player => player.active && player.currentRoomID === roomID && !player.spectating).length;
            if (this.maxPlayersPerGame && this.maxPlayersPerGame > 0 && numPlayers >= this.maxPlayersPerGame) {
                this.handleError(ws, event, 'max players exceeded', StatusCodes.BAD_REQUEST);
                return;
            }
        }
        try {
            await this.db.players.updateByID(playerID, {spectating: false});
        } catch (e) {
            this.roomLogger.error(roomID, `Failed to stop spectating for ${playerID}: ${e}`);
            return;
        }
        this.roomLogger.info(roomID, `${this.getPlayerName(playerID)} stopped spectating.`);
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_STOPPED_SPECTATING, {roomID, playerID}));
    }

    /* Handler for ABANDON_GAME events. */
    async handleAbandonGame(ws, event) {
        const { roomID, gameID } = event.payload?.context || {};
        const { room } = await this.validateEventContext(ws, event);
        if (!room) {
            return;
        }
        const hostWS = this.getClient(roomID, room.hostPlayerID);
        if (!hostWS || ws !== hostWS) {
            this.handleError(ws, event, 'only the host may abandon games', StatusCodes.FORBIDDEN);
            return;
        }
        try {
            await this.db.rooms.setCurrentGameForRoom(room, null);
        } catch (e) {
            this.roomLogger.error(roomID, `Failed to abandon game: ${e}`);
            return;
        }
        this.roomLogger.info(roomID, `Host abandoned game ${gameID}.`);
        this.broadcast(new WebsocketEvent(EventTypes.HOST_ABANDONED_GAME, event.payload));
    }

    /* Handler for KICK_PLAYER events. */
    async handleKickPlayer(ws, event) {
        const { roomID, playerID, duration } = event.payload || {};
        if (!roomID) {
            this.handleError(ws, event, 'missing room ID', StatusCodes.BAD_REQUEST);
            return;
        }
        if (!playerID) {
            this.handleError(ws, event, 'missing player ID', StatusCodes.BAD_REQUEST);
            return;
        }
        const room = await this.db.rooms.getByID(roomID);
        if (!room) {
            this.handleError(ws, event, 'room not found', StatusCodes.NOT_FOUND);
            return;
        }
        const player = await this.db.players.getByID(playerID);
        if (!player) {
            this.handleError(ws, event, 'player not found', StatusCodes.NOT_FOUND);
            return;
        }
        const hostWS = this.getClient(roomID, room.hostPlayerID);
        if (!hostWS || ws !== hostWS) {
            this.handleError(ws, event, 'only the host may kick players', StatusCodes.FORBIDDEN);
            return;
        }
        if (!room.playerIDs.includes(playerID) || player.currentRoomID !== roomID) {
            this.handleError(ws, event, 'player not in room', StatusCodes.BAD_REQUEST);
            return;
        }
        if (room.kickedPlayerIDs.hasOwnProperty(playerID)) {
            this.handleError(ws, event, 'player already kicked from room', StatusCodes.BAD_REQUEST);
            return;
        }
        let expiration = null;
        let durationInSeconds = parseInt(duration);
        if (isNaN(durationInSeconds) || durationInSeconds < 0 || durationInSeconds > MAX_KICK_DURATION_SECONDS) {
            this.handleError(ws, event, 'invalid duration', StatusCodes.BAD_REQUEST);
            return;
        }
        if (durationInSeconds > 0) {
            expiration = Date.now() + (durationInSeconds * 1000);
        }
        try {
            await this.db.rooms.updateByID(roomID, {[`kickedPlayerIDs.${playerID}`]: expiration});
            await this.db.players.updateByID(playerID, {currentRoomID: null});
        } catch (e) {
            this.roomLogger.error(roomID, `Failed to kick player ${playerID}: ${e}`);
            return;
        }
        this.roomLogger.info(roomID, `Host kicked ${this.getPlayerName(playerID)} ${expiration === null ? 'indefinitely' : 'until ' + new Date(expiration).toLocaleString()}.`);
        /* NOTE: order matters here - need to broadcast before removing the player's websocket from the room */
        this.broadcast(new WebsocketEvent(EventTypes.HOST_KICKED_PLAYER, event.payload));
        const playerWS = this.removeClient(roomID, playerID);
        if (playerWS) {
            this.addClient(NO_ROOM_KEY, playerID, playerWS);
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
                this.handleError(ws, event, 'player was kicked from room', StatusCodes.CONFLICT);
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
        let players;
        try {
            players = await this.db.players.getByIDs(room.playerIDs);
        } catch (e) {
            this.handleError(ws, event, 'failed to get players in room', StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }
        let newPlayers = {[player.playerID]: player};
        players.forEach(player => {
            if (player.currentRoomID === room.roomID) {
                newPlayers[player.playerID] = player;
            }
        });
        if (!player.spectating && this.maxPlayersPerGame && this.maxPlayersPerGame > 0 &&
                Object.values(newPlayers).filter(player => player.active && !player.spectating).length > this.maxPlayersPerGame) {
            this.roomLogger.info(room.roomID, `Room is full. ${player.name} is becoming a spectator.`);
            await this.db.players.updateByID(player.playerID, {spectating: true});
            newPlayers[player.playerID].spectating = true;
        }
        this.broadcast(new WebsocketEvent(EventTypes.PLAYER_JOINED_ROOM, {roomID: room.roomID, playerID: player.playerID, players: newPlayers}));
    }
}
