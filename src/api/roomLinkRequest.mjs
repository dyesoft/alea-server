import log from 'log';
import {
    MAX_EMAIL_LENGTH,
    MAX_ROOM_REQUEST_NAME_LENGTH,
    RoomLinkRequest,
    RoomLinkRequestResolution,
    StatusCodes,
    validateEmail,
} from '@dyesoft/alea-core';
import { APIRouteDefinition } from './common.mjs';

const logger = log.get('api:room-link-request');

/* API route definition for room-link-request–related endpoints. */
class RoomLinkRequestAPI extends APIRouteDefinition {
    /* Create a new Room Link Request API using the given database connection and mailer. */
    constructor(db, mailer) {
        super(db, null, mailer);
        this.get('/', this.handleGetRoomLinkRequests.bind(this));
        this.post('/', this.handleCreateRoomLinkRequest.bind(this));
        this.get('/:requestID', this.handleGetRoomLinkRequest.bind(this));
        this.put('/:requestID', this.handleResolveRoomLinkRequest.bind(this));
    }

    /* Handler for GET /request. */
    async handleGetRoomLinkRequests(req, res, error) {
        const resolutionParam = req.query.resolution;
        let resolution = null;
        if (resolutionParam) {
            resolution = resolutionParam.toLowerCase();
            if (!Object.values(RoomLinkRequestResolution).includes(resolution)) {
                error(`Invalid resolution "${resolutionParam}"`, StatusCodes.BAD_REQUEST);
                return;
            }
        }

        let response;
        try {
            response = await this.getPaginationResponse(req, 'requests', this.db.roomLinkRequests.count, this.db.roomLinkRequests.getPageOfRoomLinkRequests, [resolution]);
        } catch (e) {
            error(e.message, e.status);
            return;
        }

        res.json(response);
    }

    /* Handler for POST /request. */
    async handleCreateRoomLinkRequest(req, res, error) {
        logger.debug('Creating a request for a new room link.');

        if (!req.body.hasOwnProperty('name')) {
            error('Name is required', StatusCodes.BAD_REQUEST);
            return;
        }
        const name = req.body.name?.toString().trim();
        if (!name || name.length > MAX_ROOM_REQUEST_NAME_LENGTH) {
            error(`Invalid name "${name}"`, StatusCodes.BAD_REQUEST);
            return;
        }

        if (!req.body.hasOwnProperty('email')) {
            error('Email is required', StatusCodes.BAD_REQUEST);
            return;
        }
        const email = req.body.email?.toString().trim();
        if (!email || email.length > MAX_EMAIL_LENGTH || !validateEmail(email)) {
            error(`Invalid email "${email}"`, StatusCodes.BAD_REQUEST);
            return;
        }

        const previousRequest = await this.db.roomLinkRequests.getByEmail(email);
        if (previousRequest) {
            error(`Room link request already exists for email "${email}"`, StatusCodes.CONFLICT);
            return;
        }

        const roomLinkRequest = new RoomLinkRequest(name, email);
        try {
            await this.db.roomLinkRequests.create(roomLinkRequest);
        } catch (e) {
            error(`Failed to save room link request to database: ${e}`, StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }

        res.json(roomLinkRequest);
        logger.info(`Created room link request ${roomLinkRequest.requestID} for ${name} (${email}).`);

        await this.mailer.sendRoomLinkRequestCreatedMessage(roomLinkRequest);
    }

    /* Handler for GET /request/:requestID. */
    async handleGetRoomLinkRequest(req, res, error) {
        const requestID = req.params.requestID;
        const roomLinkRequest = await this.db.roomLinkRequests.getByID(requestID);
        if (roomLinkRequest) {
            res.json(roomLinkRequest);
        } else {
            error(`Room link request "${requestID}" not found`, StatusCodes.NOT_FOUND);
        }
    }

    /* Handler for PUT /request/:requestID. */
    async handleResolveRoomLinkRequest(req, res, error) {
        const requestID = req.params.requestID;
        const roomLinkRequest = await this.db.roomLinkRequests.getByID(requestID);
        if (!roomLinkRequest) {
            error(`Room link request "${requestID}" not found`, StatusCodes.NOT_FOUND);
            return;
        }
        if (roomLinkRequest.resolution !== RoomLinkRequestResolution.UNRESOLVED) {
            error(`Room link request "${requestID}" is already resolved`, StatusCodes.BAD_REQUEST);
            return;
        }

        if (!req.body.hasOwnProperty('resolution')) {
            error('Resolution is required', StatusCodes.BAD_REQUEST);
            return;
        }
        const resolution = req.body.resolution?.toString().toLowerCase().trim();
        if (!resolution || !Object.values(RoomLinkRequestResolution).includes(resolution) || resolution === RoomLinkRequestResolution.UNRESOLVED) {
            error(`Invalid resolution "${resolution}"`, StatusCodes.BAD_REQUEST);
            return;
        }

        /* TODO - verify that an admin is making the request to resolve? */

        const resolvedTime = new Date();
        try {
            await this.db.roomLinkRequests.resolveByID(requestID, resolution, resolvedTime);
        } catch (e) {
            error(`Failed to resolve room link request: ${e}`, StatusCodes.INTERNAL_SERVER_ERROR);
            return;
        }

        roomLinkRequest.resolution = resolution;
        roomLinkRequest.resolvedTime = resolvedTime;
        res.json(roomLinkRequest);
        logger.info(`Resolved room link request ${roomLinkRequest.requestID} (${resolution}).`);

        if (resolution === RoomLinkRequestResolution.APPROVED) {
            await this.mailer.sendRoomLinkRequestApprovedMessage(roomLinkRequest);
        }
    }
}

export default RoomLinkRequestAPI;
