import uuid from 'uuid';
import { PAGE_SIZE } from '../constants.mjs';

const DEFAULT_INSERT_OPTIONS = {
    writeConcern: {
        w: 'majority',
    },
};

const DEFAULT_TRANSACTION_OPTIONS = {
    readPreference: 'primary',
    readConcern: {
        level: 'local',
    },
    writeConcern: {
        w: 'majority',
    },
};

/* Base class for working with a MongoDB collection (table). */
export default class MongoCollection {
    /* Create a Mongo collection using the given database, collection name, and ID field. */
    constructor(db, collectionName, idFieldName, pageSize = PAGE_SIZE) {
        this.idField = idFieldName;
        this.entityName = collectionName.endsWith('s') ? collectionName.substring(0, collectionName.length - 1) : collectionName;
        this.collection = db.collection(collectionName);
        this.pageSize = pageSize;

        this.create = this.create.bind(this);
        this.count = this.count.bind(this);
        this.getPaginatedList = this.getPaginatedList.bind(this);
        this.getByID = this.getByID.bind(this);
        this.getByIDs = this.getByIDs.bind(this);
        this.updateFieldsByID = this.updateFieldsByID.bind(this);
        this.updateByID = this.updateByID.bind(this);
    }

    /* Create a new record in the collection after ensuring that it has a unique ID. */
    async create(entity) {
        if (!entity[this.idField]) {
            entity[this.idField] = uuid.v4();
        }
        entity._id = entity[this.idField];
        const result = await this.collection.insertOne(entity, DEFAULT_INSERT_OPTIONS);
        if (result.insertedCount !== 1) {
            throw new Error(`Failed to create ${this.entityName}!`);
        }
    }

    /* Return the total number of records (rows) in the collection, optionally filtered by the given criteria. */
    async count(filters = null) {
        return await this.collection.find(filters || {}).count();
    }

    /* Return a paginated list of records for the given page number and sort criteria. */
    async getPaginatedList(page, sort = null, filters = null) {
        if (!sort) {
            sort = {createdTime: -1};
        }
        let cursor = this.collection.find(filters || {}).sort(sort).limit(this.pageSize);
        if (page > 1) {
            cursor = cursor.skip(this.pageSize * (page - 1));
        }
        return await cursor.toArray();
    }

    /* Return the record with the given ID. */
    async getByID(entityID) {
        return await this.collection.findOne({_id: entityID});
    }

    /* Return a list of all records with the given IDs. All IDs are expected to exist. */
    async getByIDs(entityIDs) {
        const cursor = this.collection.find({_id: {$in: entityIDs}});
        const entities = await cursor.toArray();
        if (entities.length < entityIDs.length) {
            throw new Error(`Failed to find all ${this.entityName}s!`);
        }
        return entities;
    }

    /* Make arbitrary updates to the fields of a record by ID. */
    async updateFieldsByID(entityID, updates, arrayFilters = null) {
        let opts = {};
        if (arrayFilters) {
            opts.arrayFilters = arrayFilters;
        }
        await this.collection.updateOne({_id: entityID}, updates, opts);
    }

    /* Update the values of a record's fields by ID. */
    async updateByID(entityID, newFields) {
        await this.updateFieldsByID(entityID, {$set: newFields});
    }
}
