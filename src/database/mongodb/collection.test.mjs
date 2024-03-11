import mongodb from 'mongodb';
const { MongoClient } = mongodb;

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import MongoCollection from './collection.mjs';
import { MONGO_CLIENT_OPTIONS } from './constants.mjs';

const TEST_COLLECTION_NAME = 'widgets';
const TEST_ID_FIELD_NAME = 'widgetID';

const TEST_WIDGETS = [
    {_id: 'widget1', widgetID: 'widget1', active: true, createdTime: 4},
    {_id: 'widget2', widgetID: 'widget2', active: true, createdTime: 3},
    {_id: 'widget3', widgetID: 'widget3', active: false, createdTime: 2},
    {_id: 'widget4', widgetID: 'widget4', active: false, createdTime: 1},
];

class TestMongoCollection extends MongoCollection {
    constructor(db) {
        super(db, TEST_COLLECTION_NAME, TEST_ID_FIELD_NAME);
    }
}

describe('MongoCollection', () => {
    let conn;
    let db;
    let collection;

    beforeAll(async () => {
        conn = await MongoClient.connect(global.__MONGO_URI__, MONGO_CLIENT_OPTIONS);
        db = await conn.db();
    });

    beforeEach(async () => {
        collection = new TestMongoCollection(db);
        await collection.truncate(true);
    });

    afterAll(async () => {
        await conn.close();
    });

    describe('constructor', () => {
        test('sets expected fields', () => {
            expect(collection.idField).toEqual(TEST_ID_FIELD_NAME);
            expect(collection.entityName).toEqual('widget');
            expect(collection.collection).toBeDefined();
        });
    });

    describe('ensureUniqueID', () => {
        test('ID already exists', () => {
            const name = 'test';
            const widgetID = 'widget';
            const widget = {name: name, widgetID: widgetID};
            expect(widget._id).not.toBeDefined();

            collection.ensureUniqueID(widget);
            expect(widget.widgetID).toEqual(widgetID);
            expect(widget._id).toEqual(widgetID);
            expect(widget.name).toEqual(name);
        });

        test('populates ID field if missing', () => {
            const name = 'test';
            const widget = {name: name};
            expect(widget.widgetID).not.toBeDefined();
            expect(widget._id).not.toBeDefined();

            collection.ensureUniqueID(widget);
            expect(widget.widgetID).toBeDefined();
            expect(widget._id).toBeDefined();
            expect(widget._id).toEqual(widget.widgetID);
        });
    });

    describe('create', () => {
        test('inserts entity into collection', async () => {
            const widget = {widgetID: 'widget', name: 'test'};
            await collection.create(widget);
            expect(widget._id).toEqual(widget.widgetID);

            const newWidget = await collection.getByID(widget.widgetID);
            expect(newWidget).toEqual(widget);
        });

        test('populates ID field if missing', async () => {
            const widget = {name: 'test'};
            await collection.create(widget);
            expect(widget.widgetID).toBeTruthy();
            expect(widget._id).toBeDefined();
            expect(widget._id).toEqual(widget.widgetID);

            const newWidget = await collection.getByID(widget.widgetID);
            expect(newWidget).toEqual(widget);
        });

        test('throws error on failed insertion', async () => {
            const widget = {name: 'test'};
            collection.collection.insertOne = jest.fn().mockResolvedValue({insertedCount: 0});
            await expect(async () => await collection.create(widget)).rejects.toThrow(Error);
        });
    });

    describe('createMany', () => {
        test('inserts entities into collection', async () => {
            const widgets = [
                {widgetID: 'widget1', name: 'test1'},
                {widgetID: 'widget2', name: 'test2'},
            ];
            await collection.createMany(widgets);
            widgets.forEach(widget => expect(widget._id).toEqual(widget.widgetID));

            const newWidgets = await collection.getByIDs(widgets.map(widget => widget.widgetID));
            expect(newWidgets).toHaveLength(widgets.length);
            newWidgets.sort((widget1, widget2) => widget1.name.localeCompare(widget2.name)).forEach((newWidget, i) => expect(newWidget).toEqual(widgets[i]));
        });

        test('populates ID fields if missing', async () => {
            const widgets = [{name: 'test1'}, {name: 'test2'}];
            await collection.createMany(widgets);
            widgets.forEach(widget => {
                expect(widget.widgetID).toBeDefined();
                expect(widget._id).toBeDefined();
                expect(widget._id).toEqual(widget.widgetID);
            });

            const newWidgets = await collection.getByIDs(widgets.map(widget => widget.widgetID));
            newWidgets.sort((widget1, widget2) => widget1.name.localeCompare(widget2.name)).forEach((newWidget, i) => expect(newWidget).toEqual(widgets[i]));
        });

        test('throws error on failed insertion', async () => {
            const widgets = [{name: 'test1'}, {name: 'test2'}];
            collection.collection.insertMany = jest.fn().mockResolvedValue({insertedCount: 0});
            await expect(async () => await collection.createMany(widgets)).rejects.toThrow(Error);
        });
    });

    describe('count', () => {
        test('no filters', async () => {
            let expectedCount = 0;
            let count = await collection.count();
            expect(count).toEqual(expectedCount);
            for (let widget of TEST_WIDGETS) {
                expectedCount += 1;
                await collection.create(widget);
                count = await collection.count();
                expect(count).toEqual(expectedCount);
            }
        });

        test('with filters', async () => {
            await collection.createMany(TEST_WIDGETS);
            const count = await collection.count({active: true});
            expect(count).toEqual(2);
        });
    });

    describe('getPaginatedList', () => {
        test('first page, default sort order, no filters', async () => {
            await collection.createMany(TEST_WIDGETS);
            const page = await collection.getPaginatedList(1);
            expect(page).toEqual(TEST_WIDGETS);
        });

        test('later page, default sort order, no filters', async () => {
            const pageSize = TEST_WIDGETS.length / 2;
            collection.pageSize = pageSize;
            await collection.createMany(TEST_WIDGETS);
            const page = await collection.getPaginatedList(2);
            expect(page).toHaveLength(pageSize);
            expect(page).toEqual(TEST_WIDGETS.slice(pageSize));
        });

        test('custom sort order, no filters', async () => {
            await collection.createMany(TEST_WIDGETS);
            const page = await collection.getPaginatedList(1, {createdTime: 1});
            expect(page).toEqual(TEST_WIDGETS.slice().reverse());
        });

        test('default sort order with filters', async () => {
            await collection.createMany(TEST_WIDGETS);
            const page = await collection.getPaginatedList(1, null, {active: true});
            expect(page).toHaveLength(2);
            page.forEach(widget => expect(widget.active).toBe(true));
            expect(page[0].createdTime).toBeGreaterThan(page[1].createdTime);
        });

        test('custom sort order with filters', async () => {
            await collection.createMany(TEST_WIDGETS);
            const page = await collection.getPaginatedList(1, {createdTime: 1}, {active: true});
            expect(page).toHaveLength(2);
            page.forEach(widget => expect(widget.active).toBe(true));
            expect(page[0].createdTime).toBeLessThan(page[1].createdTime);
        });
    });

    describe('getByID', () => {
        test('returns entity with matching ID', async () => {
            const widgetID = 'widget';
            const expectedWidget = {_id: widgetID, widgetID: widgetID, name: 'test'};
            await collection.create(expectedWidget);
            const widget = await collection.getByID(widgetID);
            expect(widget).toEqual(expectedWidget);
        });
    });

    describe('getByIDs', () => {
        test('returns entities with matching IDs', async () => {
            const widgetIDs = ['widget1', 'widget2', 'widget3', 'widget4'];
            await collection.createMany(TEST_WIDGETS);
            const widgets = await collection.getByIDs(widgetIDs);
            expect(widgets).toEqual(TEST_WIDGETS);
        });

        test('throws error if not all entities found', async () => {
            const widgetIDs = ['widget1', 'widget2', 'widget3', 'widget4', 'widget5'];
            await collection.createMany(TEST_WIDGETS);
            await expect(async () => await collection.getByIDs(widgetIDs)).rejects.toThrow(Error);
        });
    });

    describe('updateFieldsByID', () => {
        test('no array filters', async () => {
            const widgetID = 'widget';
            await collection.create({widgetID: widgetID, name: 'test', subWidgets: ['foo']});
            await collection.updateFieldsByID(widgetID, {
                $addToSet: {subWidgets: 'bar'},
                $set: {name: 'test update'},
            });
            const widget = await collection.getByID(widgetID);
            expect(widget.name).toEqual('test update');
            expect(widget.subWidgets).toEqual(['foo', 'bar']);
        });

        test('with array filters', async () => {
            const widgetID = 'widget';
            await collection.create({widgetID: widgetID, subWidgets: [{name: 'foo'}, {name: 'test'}]});
            await collection.updateFieldsByID(
                widgetID,
                {$set: {'subWidgets.$[subWidget].name': 'test update'}},
                [{'subWidget.name': 'test'}]
            );
            const widget = await collection.getByID(widgetID);
            expect(widget.subWidgets).toEqual([{name: 'foo'}, {name: 'test update'}]);
        });
    });

    describe('updateByID', () => {
        test('sets provided entity fields', async () => {
            const widgetID = 'widget';
            const newFields = {name: 'test update'};
            await collection.create({widgetID: widgetID, name: 'test'});
            await collection.updateByID(widgetID, newFields);
            const widget = await collection.getByID(widgetID);
            expect(widget.name).toEqual(newFields.name);
        });
    });

    describe('truncate', () => {
        test('does nothing if confirm is false (or not provided)', async () => {
            const widgets = [{name: 'test1'}, {name: 'test2'}];
            await collection.createMany(widgets);
            let count = await collection.count();
            expect(count).toEqual(widgets.length);

            await collection.truncate();
            count = await collection.count();
            expect(count).toEqual(widgets.length);
        });

        test('deletes all entities if confirm is true', async () => {
            const widgets = [{name: 'test1'}, {name: 'test2'}];
            await collection.createMany(widgets);
            let count = await collection.count();
            expect(count).toEqual(widgets.length);

            await collection.truncate(true);
            count = await collection.count();
            expect(count).toEqual(0);
        });
    });
});
