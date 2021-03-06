/**
 *
 * The Bipio Feed Pod.  list action definition
 * ---------------------------------------------------------------
 *
 * @author Michael Pearson <michael@cloudspark.com.au>
 * Copyright (c) 2010-2013 CloudSpark pty ltd http://www.cloudspark.com.au
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var djs = require('datejs'),
RSSFeed = require('rss'),
request = require('request');

function Feed(podConfig) {
    this.name = 'feed';
    this.description = 'Create A Feed',
    this.description_long = 'Creates an syndication from content you receive from Bips',
    this.trigger = false; // this action can trigger
    this.singleton = false; // only 1 instance per account (can auto install)
    this.auto = false; // no config, not a singleton but can auto-install anyhow
    this.podConfig = podConfig; // general system level config for this pod (transports etc)
}

Feed.prototype = {};

Feed.prototype.getSchema = function() {
    return {
        'renderers' : {
            'rss' : {
                description : 'RSS 2.0',
                description_long : 'Serves stored items as an RSS 2.0 Feed',
                contentType : DEFS.CONTENTTYPE_XML
            }
        },        
        "imports": {
            properties : {
                'title' : {
                    type : 'string',
                    description : 'Title'
                },
                'description' : {
                    type : 'string',
                    description : 'Description'
                },
                'url' : {
                    type : 'string',
                    description : 'Item URL'
                },
                'author' : {
                    type : 'string',
                    description : 'Author name'
                },
                'category' : {
                    type : 'string',
                    description : 'Category Name'
                },
                'created_time' : {
                    type : 'string',
                    description : 'UTC Created Time'
                }
            }
        }
    }
}

Feed.prototype.setup = function(channel, accountInfo, next) {
    var $resource = this.$resource,
    self = this,
    dao = $resource.dao,
    log = $resource.log,
    modelName = this.$resource.getDataSourceName('feed');

    (function(channel, accountInfo, next) {
        var feedStruct = {
            owner_id : channel.owner_id,
            channel_id : channel.id,
            last_update : app.helper.nowUTCSeconds(),
            last_build : app.helper.nowUTCSeconds()
        }

        model = dao.modelFactory(modelName, feedStruct, accountInfo);
        dao.create(model, function(err, result) {
            if (err) {
                log(err, channel, 'error');
            }
            next(err, 'channel', channel);

        }, accountInfo);
    })(channel, accountInfo, next);
}

/**
 * Invokes (runs) the action.
 */
Feed.prototype.invoke = function(imports, channel, sysImports, contentParts, next) {
    var $resource = this.$resource,
    self = this,
    dao = $resource.dao,
    log = $resource.log,
    modelName = this.$resource.getDataSourceName('feed'),
    entityModelName = this.$resource.getDataSourceName('feed_entity');

    (function(imports, channel, sysImports, next) {
        // get feed metadata
        dao.find(
            modelName,
            {
                owner_id : channel.owner_id,
                channel_id : channel.id
            },
            function(err, result) {
                if (err) {
                    log(err, channel, 'error');
                } else {
                    // set last update time (now)
                    dao.updateColumn(
                        modelName,
                        {
                            id : result.id
                        },
                        {
                            last_update : app.helper.nowUTCSeconds()
                        }
                        );

                    // insert entry
                    var entityStruct = {
                        feed_id : result.id,
                        title : imports.title,
                        url : imports.url,
                        author : imports.author,
                        description : imports.description,
                        category : imports.category,
                        entity_created : imports.created_time && imports.created_time !== '' ?
                        Date.parse(imports.created_time).getTime()/1000 :
                        app.helper.nowUTCSeconds()
                    }

                    model = dao.modelFactory(entityModelName, entityStruct);
                    dao.create(model, function(err, result) {
                        if (err) {
                            log(err, channel, 'error');
                        }
                        next(
                            err,
                            {
                                id : result.id
                            }
                            );
                    });
                }
            }
            );

    })(imports, channel, sysImports, next);
}

Feed.prototype.rpc = function(method, sysImports, options, channel, req, res) {
    var $resource = this.$resource,
    self = this,
    dao = $resource.dao,
    log = $resource.log,
    modelName = this.$resource.getDataSourceName('feed'),
    entityModelName = this.$resource.getDataSourceName('feed_entity');

    // @todo - cache compiled feed to disk
    if (method == 'rss') {
        (function(channel, req, res) {
            dao.find(
                modelName,
                {
                    owner_id : channel.owner_id,
                    channel_id : channel.id
                },
                function(err, result) {
                    if (err) {
                        log(err, channel, 'error');
                        res.send(500);
                    } else if (!result) {
                        res.send(404);
                    } else {
                        // get last 10 entities
                        var account = {
                            user : {
                                id : channel.owner_id
                            }
                        };

                        var page_size = 10,
                            page = 1,
                            order_by = 'recent';

                        if (undefined != req.query.page_size) {
                            page_size = parseInt(req.query.page_size);
                        }

                        if (undefined != req.query.page) {
                            page = parseInt(req.query.page);
                        }

                        var filter = {
                            feed_id : result.id
                        };
                        // extract filters
                        if (undefined != req.query.filter) {
                            var tokens = req.query.filter.split(',');
                            for (i in tokens) {
                                var filterVars = tokens[i].split(':');
                                if (undefined != filterVars[0] && undefined != filterVars[1]) {
                                    filter[filterVars[0]] = filterVars[1];
                                }
                            }
                        }

                        dao.list(
                            entityModelName,
                            null,
                            page_size,
                            page,
                            'entity_created',
                            filter,
                            function(err, modelName, results) {
                                if (err) {
                                    log(err, channel, 'error');
                                    res.send(500);
                                } else {
                                    var struct = {
                                        'meta' : {
                                            title: channel.name,
                                            feed_url : channel.getRendererUrl('rss', req.remoteUser), // self renderer
                                            site_url : req.remoteUser.getDefaultDomainStr(true), // self renderer
                                            image : '', // channel config icon image
                                            description: channel.note,
                                            author : req.remoteUser.getName()
                                        }
                                    };
                                    var renderOpts = {
                                        content_type : self.getSchema().renderers.rss.contentType
                                    };

                                    feed = new RSSFeed(struct.meta);
                                    for (var i = 0; i < results.data.length; i++) {
                                        results.data[i].guid = results.data[i].id;
                                        results.data[i].categories = [ results.data[i].category ];
                                        feed.item(results.data[i]);
                                    }

                                    res.contentType(self.getSchema().renderers.rss.contentType);
                                    res.send(feed.xml());
                                }
                            });
                        }
                    }
                );
        })(channel, req, res);
    }
};

// -----------------------------------------------------------------------------
module.exports = Feed;