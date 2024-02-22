import express from 'express';
import { StatusCodes } from '@dyesoft/alea-core';

/* Error subclass containing an error message and a status code. */
export class APIError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
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
    /* Create a new API route definition using the given database connection. */
    constructor(db, mailer) {
        this.db = db || null;
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
        return (req, res, next) => {
            const handleError = (message, status) => next(new APIError(message, status));
            handler(req, res, handleError);
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
