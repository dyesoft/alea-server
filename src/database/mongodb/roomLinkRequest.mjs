import { RoomLinkRequestResolution } from '@dyesoft/alea-core';
import MongoCollection from './collection.mjs';

/* Data access class for working with room link requests. */
export default class RoomLinkRequestCollection extends MongoCollection {
    /* Create a new room link request collection using the given database. */
    constructor(db) {
        super(db, 'roomLinkRequests', 'requestID');

        this.count = this.count.bind(this);
        this.getPageOfRoomLinkRequests = this.getPageOfRoomLinkRequests.bind(this);
        this.getByEmail = this.getByEmail.bind(this);
        this.resolveByID = this.resolveByID.bind(this);
        this.setRoomByID = this.setRoomByID.bind(this);
    }

    /* Return the total number of requests in the collection, optionally filtered by resolution status. */
    async count(resolution) {
        let filters = {};
        if (resolution) {
            filters.resolution = resolution;
        }
        return await super.count(filters);
    }

    /* Return a paginated list of requests for the given page number, optionally filtered by resolution status. */
    async getPageOfRoomLinkRequests(page, resolution) {
        let filters = {};
        if (resolution) {
            filters.resolution = resolution;
        }
        return await this.getPaginatedList(page, null, filters);
    }

    /* Return the room link request with the given email. */
    async getByEmail(email) {
        return await this.collection.findOne({email: email, resolution: RoomLinkRequestResolution.UNRESOLVED});
    }

    /* Resolve the given request with the given resolution and resolved time. */
    async resolveByID(requestID, resolution, resolvedTime) {
        await this.updateByID(requestID, {resolution: resolution, resolvedTime: resolvedTime});
    }

    /* Set the room ID and room code for the given request. */
    async setRoomByID(requestID, roomID, roomCode) {
        await this.updateByID(requestID, {roomID: roomID, roomCode: roomCode});
    }
}
