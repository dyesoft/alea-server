import log from 'log';
import {
    EventTypes,
    MAX_PASSWORD_LENGTH,
    Room,
    RoomLinkRequestResolution,
    ROOM_CODE_LENGTH,
    StatusCodes,
    validateRoomCode,
    WebsocketEvent,
} from '@dyesoft/alea-core';
import { APIRouteDefinition } from './common.mjs';

const logger = log.get('api:room');

/* API route definition for room-related endpoints. */
class RoomAPI extends APIRouteDefinition {
    /* Create a new Room API using the given database connection and mailer. */
    constructor(db, wss, mailer, adminPlayerIDs) {
        super(db, wss, mailer);
        this.adminPlayerIDs = new Set(adminPlayerIDs || []);
        this.get('/', this.handleGetRooms.bind(this));
        this.post('/', this.handleCreateRoom.bind(this));
        this.get('/:roomID', this.handleGetRoom.bind(this));
        this.get('/:roomID/history', this.handleGetRoomHistory.bind(this));
    }

    /* Handler for GET /room. */
    async handleGetRooms(req, res, error) {
        let response;
        try {
            response = await this.getPaginationResponse(req, 'rooms', this.db.rooms.count, this.db.rooms.getPaginatedList);
        } catch (e) {
            error(e.message, e.status);
            return;
        }

        let uniquePlayerIDs = new Set();
        response.rooms.forEach(room => {
            uniquePlayerIDs.add(room.ownerPlayerID);
            room.playerIDs.forEach(playerID => uniquePlayerIDs.add(playerID));
        });

        let playerNames = {};
        try {
            const players = await this.db.players.getByIDs(new Array(...uniquePlayerIDs));
            players.forEach(player => playerNames[player.playerID] = player.name);
        } catch (e) {
            logger.error(`Failed to get players in rooms: ${e}`);
            error('Failed to get players', StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }
        response.playerNames = playerNames;
        res.json(response);
    }

    /* Handler for POST /room. */
    async handleCreateRoom(req, res, error) {
        logger.info('Creating a new room.');

        const ownerPlayerID = req.body.ownerPlayerID?.toString().trim();
        const player = await this.db.players.getByID(ownerPlayerID);
        if (!player) {
            error(`Invalid owner player ID "${ownerPlayerID}"`, StatusCodes.BAD_REQUEST);
            return;
        }

        let password = null;
        if (req.body.hasOwnProperty('password')) {
            password = req.body.password;
            if (password !== null && (!password || password.length > MAX_PASSWORD_LENGTH)) {
                error('Invalid password', StatusCodes.BAD_REQUEST);
                return;
            }
        }

        let roomCode = req.body.roomCode?.toString().toUpperCase().trim();
        if (roomCode) {
            if (!validateRoomCode(roomCode)) {
                error(`Invalid room code "${roomCode}"`, StatusCodes.BAD_REQUEST);
                return;
            }
            const room = await this.db.rooms.getByRoomCode(roomCode);
            if (room) {
                error(`Room with code "${roomCode}" already exists`, StatusCodes.CONFLICT);
                return;
            }
        } else {
            roomCode = await this.db.rooms.generateUniqueRoomCode();
        }

        let requestID = req.body.requestID?.toString().trim();
        let roomLinkRequest = null;
        if (requestID) {
            roomLinkRequest = await this.db.roomLinkRequests.getByID(requestID);
            if (!roomLinkRequest || roomLinkRequest.resolution !== RoomLinkRequestResolution.APPROVED) {
                error(`Invalid room link request ID "${requestID}"`, StatusCodes.BAD_REQUEST);
                return;
            }
            if (roomLinkRequest.roomID) {
                error(`Room link request "${requestID}" has already been redeemed`, StatusCodes.BAD_REQUEST);
                return;
            }
        } else if (!this.adminPlayerIDs.has(ownerPlayerID)) {
            error(`Missing room link request ID`, StatusCodes.BAD_REQUEST);
            return;
        }

        const room = new Room(roomCode, ownerPlayerID, password);
        try {
            await this.db.rooms.create(room);
        } catch (e) {
            logger.error(`Failed to save room to database: ${e}`);
            error('Failed to save room to database', StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }

        if (requestID) {
            try {
                await this.db.roomLinkRequests.setRoomByID(requestID, room.roomID, roomCode);
            } catch (e) {
                logger.error(`Failed to update room link request in database: ${e}`);
                error('Failed to update database', StatusCodes.INTERNAL_SERVER_ERROR);
                return;
            }
        }

        await this.db.players.updateByID(ownerPlayerID, {currentRoomID: room.roomID});
        if (player.currentRoomID) {
            const newHostPlayerID = await this.db.removePlayerFromRoom(player);
            if (newHostPlayerID) {
                logger.info(`Reassigning host for room ${player.currentRoomID} to ${this.wss.getPlayerName(newHostPlayerID)}.`);
            }
            const payload = {roomID: player.currentRoomID, playerID: player.playerID, newHostPlayerID: newHostPlayerID};
            this.wss.broadcast(new WebsocketEvent(EventTypes.PLAYER_LEFT_ROOM, payload), player.playerID);
        }

        res.json(room);
        logger.info(`Created room ${room.roomID} (short code: ${room.roomCode}).`);

        if (roomLinkRequest) {
            await this.mailer.sendRoomCreatedMessage(room.roomCode, roomLinkRequest);
        }
    }

    /* Handler for GET /room/:roomID. */
    async handleGetRoom(req, res, error) {
        const roomID = req.params.roomID;
        const room = await (roomID.length === ROOM_CODE_LENGTH ? this.db.rooms.getByRoomCode(roomID) : this.db.rooms.getByID(roomID));
        if (room) {
            res.json(room);
        } else {
            error(`Room "${roomID}" not found`, StatusCodes.NOT_FOUND);
        }
    }

    /* Handler for GET /room/:roomID/history. */
    async handleGetRoomHistory(req, res, error) {
        const roomID = req.params.roomID;
        const roomHistory = await (roomID.length === ROOM_CODE_LENGTH ? this.db.rooms.getHistoryByRoomCode(roomID) : this.db.rooms.getHistoryByID(roomID));
        if (roomHistory) {
            res.json(roomHistory);
        } else {
            error(`Room "${roomID}" not found`, StatusCodes.NOT_FOUND);
        }
    }
}

export default RoomAPI;
