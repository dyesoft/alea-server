import express from 'express';
import log from 'log';
import { StatusCodes } from '@dyesoft/alea-core';
import {PAGE_SIZE} from "../database/constants.mjs";

const logger = log.get('api:common');

/* Error subclass containing an error message and a status code. */
export class APIError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

/* Custom express error handler function to return API errors as JSON. */
export function apiErrorHandler(err, req, res, next) {
    if (err instanceof APIError) {
        res.status(err.status);
        res.json({error: err.message, status: err.status});
        next();
    } else {
        next(err);
    }
}

/* Returns a custom express middleware function to log API requests using the given logger. */
export function apiRequestLogHandler(logger) {
    return (req, res, next) => {
        logger.info(`Request:  ${req.ip} ---> ${req.method} ${req.url}`);
        next();
    };
}

/* Returns a custom express middleware function to log API responses using the given logger. */
export function apiResponseLogHandler(logger) {
    return (req, res, next) => {
        logger.info(`Response: ${req.ip} <--- ${req.method} ${req.url}, status: ${res.statusCode}`);
        next();
    };
}

/* Data object used for paginating data sets in JSON responses. */
export class PaginationResponse {
    constructor(hasMore, total, currentPage, items, itemKey) {
        this.more = hasMore;
        this.total = total;
        this.page = currentPage;
        this[itemKey] = items;
    }
}

/* APIRouteDefinition encapsulates a router and the handlers for the router's routes. */
export class APIRouteDefinition {
    /* Create a new API route definition using the given database connection, websocket server, and mailer. */
    constructor(db, wss, mailer) {
        this.db = db || null;
        this.wss = wss || null;
        this.mailer = mailer || null;
        this._router = express.Router();
    }

    /* Return a reference to the express.Router object. */
    getRouter() {
        return this._router;
    }

    /*
     * Return a wrapper around a handler function to adapt it to the express API, for convenience.
     * The handler should accept a request, response, and error handler function.
     * The error handler function accepts an error message and status code.
     */
    wrapHandler(handler) {
        return async (req, res, next) => {
            const handleError = (message, status) => next(new APIError(message, status));
            try {
                await handler(req, res, handleError);
                next();
            } catch (e) {
                next(e);
            }
        };
    }

    /*
     * Return the parsed value of the `page` query parameter, or throw an error if the parameter is invalid.
     * If the query parameter is missing, (page) 1 is returned by default.
     */
    getPageParam(req) {
        const pageParam = req.query.page || 1;
        const page = parseInt(pageParam);
        if (isNaN(page) || page < 1) {
            throw new APIError(`Invalid page "${pageParam}"`, StatusCodes.BAD_REQUEST);
        }
        return page;
    }

    /*
     * Return a PaginationResponse formed by querying the database using the provided functions.
     * The req parameter is the HTTP request from express.
     * The itemKey parameter is the name of the entity in the plural, e.g., 'widgets'.
     * The count function should return a Promise that resolves to the total number of entities in the database.
     * The getPaginatedList function should accept the requested page number and return a Promise that resolves to the entities for the given page as an array.
     * The args, if provided, will be passed to both count and getPaginatedList.
     */
    async getPaginationResponse(req, itemKey, count, getPaginatedList, args) {
        const page = this.getPageParam(req);
        let total = 0;
        let hasMore = false;
        let items = [];
        args = args || [];

        try {
            total = await count(...args);
        } catch (e) {
            logger.error(`Failed to get count of ${itemKey}: ${e}`);
            throw new APIError(`Failed to get count of ${itemKey}`, StatusCodes.INTERNAL_SERVER_ERROR);
        }

        if (page > 1 && total <= (page - 1) * PAGE_SIZE) {
            throw new APIError(`Invalid page "${page}"`, StatusCodes.BAD_REQUEST);
        }

        if (total > 0) {
            try {
                items = await getPaginatedList(page, ...args);
            } catch (e) {
                logger.error(`Failed to get ${itemKey}: ${e}`);
                throw new APIError(`Failed to get ${itemKey}`, StatusCodes.INTERNAL_SERVER_ERROR);
            }
            hasMore = (total > page * PAGE_SIZE);
        }

        return new PaginationResponse(hasMore, total, page, items, itemKey);
    }

    /* Add a route for requests with the HTTP DELETE method. */
    delete(path, handler) {
        this._router.delete(path, this.wrapHandler(handler));
    }

    /* Add a route for requests with the HTTP GET method. */
    get(path, handler) {
        this._router.get(path, this.wrapHandler(handler));
    }

    /* Add a route for requests with the HTTP PATCH method. */
    patch(path, handler) {
        this._router.patch(path, this.wrapHandler(handler));
    }

    /* Add a route for requests with the HTTP POST method. */
    post(path, handler) {
        this._router.post(path, this.wrapHandler(handler));
    }

    /* Add a route for requests with the HTTP PUT method. */
    put(path, handler) {
        this._router.put(path, this.wrapHandler(handler));
    }
}
