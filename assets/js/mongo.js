require(
  ["jquery", "d3.v3", "backbone", "underscore", "querystring"],
  function($, d3, Backbone, _, QueryString) {
    $(function() {
      $.fn.onEnterKey = function(closure) {
        $(this).keypress(
          function(event) {
            code = event.keyCode ? event.keyCode : event.which;
            if (code == 13) {
              closure();
              return false;
            }
          });
      }
      $.QueryString = new QueryString(window.location.search);
      $.FragmentString = new QueryString(window.location.hash);

      var Shard = Backbone.Model.extend({
        defaults: function() {
          return {
            name: '<none>',
            host: null,
            collections: new CollectionList(),
            chunks: [],
            i: -1,
          };
        }
      });

      var ShardsList = Backbone.Collection.extend({
        model: Shard,
        comparator: function(a, b) { return a.name > b.name }
      });

      var Collection = Backbone.Model.extend({
        defaults: function() {
          return {
            name: '<none>',
            documents: 0,
            nchunks: 0,
            migrating: false,
            migrated: false,
            migrating_type: "",
            migrating_role: "",
            migrating_time: null,
            migrated_time: null,
            migrating_elapsed: 0,
          };
        },
        set_migrating: function(coll, type, from, to, time) {
          if (this.get("name") == coll && (from || to)) {
            if (this.get("migrating") && this.get("migrating_type") != type) {
              this.set("migrating_elapsed", time - this.get("migrating_time"));
            }
            this.set("migrating", true);
            this.set("migrated", false);
            this.set("migrating_type", type);
            this.set("migrating_role", from ? "from" : (to ? "to" : "?"));
            this.set("migrating_time", time);
          } else if (this.get("migrating")) {
            this.set("migrated", true);
            this.set("migrated_time", new Date());
            this.set("migrating", false);
          }
        },
      });

      var CollectionList = Backbone.Collection.extend({
        model: Collection,
        comparator: function(a, b) {
          return (a.get("migrating") == b.get("migrating")
                  ? (a.get("migrated") == b.get("migrated")
                     ? (a.get("migrating_time") == b.get("migrating_time")
                        ? a.get("name").localeCompare(b.get("name"))
                        : b.get("migrating_time") - a.get("migrating_time"))
                     : ((b.get("migrated") ? 1 : 0) - (a.get("migrated") ? 1 : 0)))
                  : ((b.get("migrating") ? 1 : 0) - (a.get("migrating") ? 1 : 0)));
        },
      });

      var shards = new ShardsList();
      var config_url;
      var requests = 0;
      var start;
      var migrating_type = "moveChunk.commit";
      var migrating_coll;
      var migrating_from;
      var migrating_to;
      var migrating_time;
      var update_interval;
      var demo_interval;
      var nf = 1;

      $.jsonp_ajax = function(opts) {
        requests += 1;
        jopts = {
          type: 'GET',
          url: opts.url,
          async: true,
          contentType: "application/json",
          dataType: "jsonp",
          jsonp: "jsonp",
          success: function(data) {
            opts.success(data);
            requests -= 1;
          },
          error: function(jqXHR, textStatus, errorThrown) {
            if (console && console.log) {
              console.log("ERROR");
              console.log(jqXHR);
              console.log(textStatus);
              console.log(errorThrown);
            } else {
              alert("error " + jqXHR + " " + textStatus + " " + errorThrown);
            }
          },
        };
        $.ajax(jopts);
      };

      function get_count(db, collection, success_func) {
        $.jsonp_ajax({
          url: config_url + db + "/$cmd/?filter_count=" + collection + "&limit=1",
          success: function(data) { success_func(data.rows[0].n) },
        });
      }

      function get_rows(db, collection, skip, success_func) {
        $.jsonp_ajax({
          url: config_url + db + "/" + collection + "/?skip=" + skip,
          success: success_func,
        });
      }

      function get_all(db, collection, row_func, success_func) {
        get_count(db, collection, function(total) {
          function get_next(skip) {
            get_rows(db, collection, skip, function(data) {
              if (data.total_rows == 0) {
                success_func();
                return;
              }
              _.each(data.rows, row_func);
              skip += data.total_rows;
              if (skip == total) {
                success_func();
              } else {
                get_next(skip);
              }
            });
          }
          get_next(0);
        });
      }

      function get_last_n(db, collection, n, success_func) {
        get_count(db, collection, function(num) {
          get_rows(db, collection, Math.max(1, num - n), success_func);
        });
      }

      function update_shards() {
        if (requests > 0) {
          return;
        }
        $.jsonp_ajax({
          url: config_url + "config/shards/",
          success: function(data) {
            /*
              var success = d3.selectAll("pre.shardSuccess").data([data]);
              success.enter().append("pre").attr("class", "shardSuccess");
              success.text(function(d) { return JSON.stringify(d, null, '\t') });
            */

            var shards_data = data;
            get_last_n("config", "changelog", 5, function(data) {
              var rows = data.rows.slice();
              rows.reverse();
              var changelog = d3.select("div#display").selectAll("pre.changelog").data([rows]);
              changelog.enter().append("pre").
                attr("class", "changelog span4").
                style("font-size", "75%")
              ;

              changelog.text(function(d) { return JSON.stringify(d, null, '  ') });
              var starts = data.rows.filter(function(r) { return r.what == 'moveChunk.start' || r.what == 'moveChunk.commit' });
              if (starts.length > 0) {
                start = starts.slice(-1)[0];
                migrating_type = start.what;
                migrating_coll = start.ns.split('.').slice(1).join('.');
                migrating_from = start.details.from;
                migrating_to = start.details.to;
                migrating_time = new Date(start.time['$date']);
                if (migrating_type == "moveChunk.commit" && (new Date() - migrating_time) > 60000) {
                  migrating_type = '';
                  migrating_coll = '';
                  migrating_from = '';
                  migrating_to = '';
                  migrating_time = '';
                }
              } else {
                migrating_type = '';
                migrating_coll = '';
                migrating_from = '';
                migrating_to = '';
                migrating_time = '';
              }

              var shard_chunks = [];
              get_all(
                "config", "chunks",
                function(row) {
                  if (shard_chunks[row.shard] == undefined) {
                    shard_chunks[row.shard] = [];
                  }
                  shard_chunks[row.shard].push(row);
                },
                function() {
                  var new_shards = [];
                  _.each(shards_data.rows, function(row) {
                    var shard = shards.find(function(c) { return c.get("name") == row._id });
                    if (!shard) {
                      shard = new Shard({
                        name: row._id,
                        host: row.host,
                      });
                    }
                    shard.set("chunks", shard_chunks[row._id]);
                    var from = shard.get("name") == migrating_from;
                    var to = shard.get("name") == migrating_to;

                    collection_names = [];
                    _.each(shard.get("chunks"), function(chunk) {
                      name = chunk.ns.split('.').slice(1).join('.');
                      num = collection_names[name];
                      if (num == undefined) {
                        num = 0;
                      }
                      collection_names[name] = num + 1;
                    });

                    var new_collections = [];
                    for (var name in collection_names) {
                      var coll = shard.get("collections").find(function(c) { return c.get("name") == name });
                      if (!coll) {
                        coll = new Collection({
                          name: name,
                        });
                      }
                      coll.set("nchunks", collection_names[name]);
                      coll.set_migrating(migrating_coll, migrating_type, from, to, migrating_time);
                      new_collections.push(coll);
                    }

                    if ((from || to)
                        && !_.find(new_collections, function(c) { return c.get("name") == migrating_coll})) {
                      var coll = new Collection({
                        name: migrating_coll,
                        nchunks: 0,
                      });
                      coll.set_migrating(migrating_coll, migrating_type, from, to, migrating_time);
                      new_collections.push(coll);
                    }
                    shard.get("collections").reset(new_collections);

                    new_shards.push(shard);
                  });
                  shards.reset(new_shards);

                  update_view(shards);
                });
            });
          },
        });
      }

      function update_view(shards) {
        shards.each(function(shard) {
          shard.set("i", shards.indexOf(shard));
        });

        var mig_data;
        if (migrating_from) {
          mig_data = {
            from: migrating_from,
            to: migrating_to,
            from_i: shards.indexOf(shards.filter(function(s) { return s.get("name") == migrating_from})[0]),
            to_i: shards.indexOf(shards.filter(function(s) { return s.get("name") == migrating_to})[0]),
          };
          mig_data.from_x = 10 + 10 + 10 + mig_data.from_i * 310;
          mig_data.to_x = 10 + 10 + 10 + mig_data.to_i * 310;
          mig_data.from_x_edge = mig_data.from_x + (mig_data.from_i < mig_data.to_i ? 280 : 0);
          mig_data.to_x_edge = mig_data.to_x + (mig_data.from_i < mig_data.to_i ? 0 : 280);
          mig_data.dir = mig_data.to_i - mig_data.from_i > 0 ? 1 : -1;
          mig_data = [mig_data];
        } else {
          mig_data = [];
        }

        var updated = d3.select("#collapsed-nav").selectAll("li.updated").
          data([new Date()]);
        updated.enter().append("li").attr("class", "updated").
          append("a").append("small");
        updated.select("small");
        updated.selectAll("small").
          text(function(d) { return "Last refresh: " + d });

        /** /
        var success = d3.selectAll("pre.shardsData").data([shards]);
        success.enter().append("pre").attr("class", "shardsData");
        success.text(function(d) { return JSON.stringify(d, null, '\t') });
        /**/

        var svg = d3.select("svg#shards");
        svg.attr("width", 30 + shards.length * 310);

        svg.select("rect.migrator");

        var shard = svg.selectAll("g.shard").data(shards.models, function(d) { return d.get("name") });

        shard.select("rect.shard");
        shard.select("text");

        var shard_g = shard.enter().append("g").
          attr("class", "shard").
          attr("transform", function(d, i) { return "translate(" + (10 + i * 310) + ", 10)"})
        ;

        shard.transition().
          duration(500).
          attr("transform", function(d, i) {
            return "translate(" + (10 + i * 310) + ", " +
              ((migrating_from && d.get("i") < Math.max(mig_data[0].from_i, mig_data[0].to_i) && d.get("i") > Math.min(mig_data[0].from_i, mig_data[0].to_i))
               ? 10 + 10 + 10 + 50
               : 10) +
              ")";
          });

        shard_g.
          append("rect").
          attr("class", "shard").
          style("fill", "#CCCCFF").
          //style("stroke", "#4444FF").
          //style("stroke-width", 2).
          attr("rx", 20).
          attr("ry", 20).
          attr("width", 50).
          /*
          attr("height", 50).
          attr("x", 10 + 150 - 25).
          attr("y", 10 + 250 - 25).
          */
          attr("width", 300).
          attr("height", 500).
          attr("x", 10).
          attr("y", 10)
          /*
          style("opacity", 0).
          transition().
          delay(function(d, i) { return 250 + i * 75 }).
          duration(500).
          style("opacity", 0.8)
          /*
          ease("bounce").
          attr("width", 300).
          attr("height", 500).
          attr("x", 10).
          attr("y", 10)
          */
        ;

        max_height = 500;
        svg.selectAll("rect.shard").
          attr("height", function(d) {
            computed_height = d.get("collections").length * 60 + 10;
            max_height = Math.max(max_height, computed_height);
            return Math.max(500, computed_height);
          })
        ;

        svg.attr("height", max_height + 10 + 10 + 10 + 10 + 50);

        shard_g.append("text").
          attr("x", 10)
        ;

        shard_g.selectAll("text").
          text(function(d) { return d.get("name") })
        ;

        shard.exit().remove();

        var colls = shard.selectAll("g.collection").
          data(function(d) { return d.get("collections").models }, function(d) { return d.get("name") })
        ;

        colls.select("rect.collection");
        colls.select("rect.pulse");
        colls.select("text.name");
        colls.select("text.nchunks");
        colls.select("text.migration");
        colls.select("text.migrationAgo");
        colls.select("text.migrationElapsed");

        var colls_g = colls.enter().append("g").
          attr("class", "collection").
          attr("transform", function(d, i) { return "translate(20," + (20 + i * 60) + ")" })
        ;

        colls.transition().duration(750).
          attr("transform", function(d, i) { return "translate(20," + (20 + i * 60) + ")" });

        /*
        colls_g.
          style("opacity", 0).
          transition().
          delay(250 + shards.length * 75 + 500).
          duration(500).
          style("opacity", 1)
        ;
        */

        colls_g.append("rect").
          attr("class", "collection").
          style("fill", "#8888FF").
          attr("rx", 10).
          attr("ry", 10).
          attr("width", 280).
          attr("height", 50)
        ;

        var now = new Date();
        var interpolate = d3.interpolateRgb("#88FF88", "#8888FF");
        colls.selectAll("rect.collection").
          transition().
          duration(750).
          style("fill", function(d) {
            var t = (1 - 5000 / ((now - d.get("migrated_time")) / 4 + 5000));
            return (d.get("migrated")
                    ? interpolate(t)
                    : (d.get("migrating") ? (d.get("migrating_type") == "moveChunk.start" ? "#FFFF88" : "#88FF88")
                       : "#8888FF"))
          })
        ;

        /*
        colls_g.append("rect").
          attr("class", "pulse").
          attr("rx", 10).
          attr("ry", 10).
          attr("width", 280).
          attr("height", 50).
          style("opacity", 0)
        ;

        colls.selectAll("rect.pulse").
          style("fill", "#000000").
          attr("x", function(d) { return d.migrating ? (d.migrating_role == "from" ? 0 : 140) : 0 }).
          attr("y", function(d) { return d.migrating ? (d.migrating_role == "from" ? 0 : 25) : 0 }).
          attr("width", function(d) { return d.migrating ? (d.migrating_role == "from" ? 280 : 0) : 0 }).
          attr("height", function(d) { return d.migrating ? (d.migrating_role == "from" ? 50 : 0) : 0 }).
          style("opacity", function(d) { return d.migrating ? (d.migrating_role == "from" ? 0.0 : 0.5) : 0.0 }).
          transition().
          delay(function(d) {return d.migrating ? (d.migrating_role == "from" ? 0 : 500) : 0 }).
          duration(750).
          attr("x", function(d) { return d.migrating ? (d.migrating_role == "from" ? 140 : 0) : 0 }).
          attr("y", function(d) { return d.migrating ? (d.migrating_role == "from" ? 25 : 0) : 0 }).
          attr("width", function(d) { return d.migrating ? (d.migrating_role == "from" ? 0 : 280) : 0 }).
          attr("height", function(d) { return d.migrating ? (d.migrating_role == "from" ? 0 : 50) : 0 }).
          style("opacity", function(d) { return d.migrating ? (d.migrating_role == "from" ? 0.5 : 0.0) : 0.0 })
          //style("fill", function(d) { return d.migrating ? (d.migrating_type == "moveChunk.start" ? "#FFFF88" : "#88FF88") : "#8888FF" })
        ;
        */

        colls_g.append("text").
          attr("class", "name").
          attr("x", 10).
          attr("y", 20)
        ;

        colls.selectAll("text.name").
          text(function(d) { return d.get("name") })
        ;

        colls_g.append("text").
          attr("class", "nchunks").
          attr("x", 10).
          attr("y", 40)
        ;

        colls.selectAll("text.nchunks").
          text(function(d) { return "chunks: " + d.get("nchunks") })
        ;

        colls_g.append("text").
          attr("class", "migrationAgo").
          style("font-size", "80%").
          attr("x", 200).
          attr("y", 20)
        ;

        colls.selectAll("text.migrationAgo").
          text(function(d) {
            return (d.get("migrating") || d.get("migrated") ?
                    (timeFormat(Math.floor((new Date() - d.get("migrating_time")) / 1000)) + " ago")
                    : "");
          })
        ;

        colls_g.append("text").
          attr("class", "migrationElapsed").
          style("font-size", "80%").
          attr("x", 200).
          attr("y", 40)
        ;

        colls.selectAll("text.migrationElapsed").
          text(function(d) {
            return (d.get("migrating_elapsed") ?
                    (timeFormat(Math.floor(d.get("migrating_elapsed") / 1000)) + " tot")
                    : "");
          })
        ;

        /*
        colls_g.append("text").
          attr("class", "migration").
          attr("y", 30)
        ;

        colls.selectAll("text.migration").
          text(function(d) {
            return (d.migrating ?
                    (d.migrating_role == "from" ? "→" : (d.migrating_role == "to" ? "←" : "?"))
                    : "");
          }).
          style("font-size", "150%").
          attr("x", function(d) { return d.migrating_role == "from" ? 130 : 180 }).
          transition().
          delay(function(d) {return d.migrating ? (d.migrating_role == "from" ? 0 : 500) : 0 }).
          duration(750).
          attr("x", function(d) { return d.migrating_role == "from" ? 180 : 130 })
        ;
        */
        /*
        colls_g.append("g").
          attr("class", "arrow").
          attr("transform", "translate(150, 21)").
          append("path").
          attr("d", "M0 4 0 6 15 6 15 10 20 5 15 0 15 4 0 4").
          style("fill", "rgb(10, 10, 10)").
          style("stroke", "rgb(20, 20, 20)").
          style("stroke-width", 1)
        ;
        */

        colls.exit().remove();

        /*
        var migrator = svg.selectAll("rect.migrator").data(mig_data, function(d) { return d });
        migrator.enter().
          append("rect").
          attr("class", "migrator").
          attr("width", 280).
          attr("height", 50).
          attr("rx", 10).
          attr("ry", 10).
          //style("opacity", 0.2).
          //style("fill", "#000000")
          style("stroke", "#4444ff").
          style("stroke-width", 3).
          style("fill", "none").
          style("opacity", 0).
          transition().
          style("opacity", 0.8)
        ;

        migrator.
          attr("x", function(d) { return d.from_x }).
          attr("y", 10 + 10 + 10).
          transition().
          duration(750).
          delay(250).
          attr("x", function(d) { return d.to_x })
        ;

        migrator.exit().transition().style("opacity", 0).remove();
        */

        var migrator = svg.selectAll("path.migrator").data(mig_data, function(d) { return d.from_i + " " + d.to_i });
        migrator.enter().
          append("path").
          attr("class", "migrator").
          attr("d", function(d) {
            var y1 = 10 + 10 + 10 + 25 - 4;
            var y2 = 10 + 10 + 10 + 25 - 12;
            var y3 = 10 + 10 + 10 + 25;
            var y4 = 10 + 10 + 10 + 25 + 12;
            var y5 = 10 + 10 + 10 + 25 + 4;
            var x1 = d.from_x_edge;
            var x2 = d.to_x_edge - d.dir * 14;
            var x3 = d.to_x_edge - d.dir * 17;
            var x4 = d.to_x_edge;
            return "M" +
              x1 + " " + y1 + " " +
              x2 + " " + y1 + " " +
              x3 + " " + y2 + " " +
              x4 + " " + y3 + " " +
              x3 + " " + y4 + " " +
              x2 + " " + y5 + " " +
              x1 + " " + y5 + " " +
              x1 + " " + y1;
            ;
          }).
          style("opacity", 0).
          style("fill", "rgb(220, 60, 60)").
          //style("stroke", "rgb(220, 60, 60)").
          //style("stroke-width", 1).
          transition().
          delay(500).
          style("opacity", 1)
        ;
        migrator.exit().
          transition().
          style("opacity", 0).
          remove();
      }

      function begin(config_host, config_port) {
        shards.reset();
        if (demo_interval) {
          $("div#demo_header").remove();
          clearInterval(demo_interval);
        }

        config_url = "http://" + config_host + ":" + config_port + "/";

        $("div#settings").addClass("collapse");

        /*
        var shards = [
          {name: "mongo-live-a",
           collections: [{name: "a"}, {name: "b"}]},
          {name: "mongo-live-b",
           collections: [{name: "c"}]},
          {name: "mongo-live-c",
           collections: [{name: "d"}, {name: "e"}, {name: "f"}]}];
        */

        update_shards();
        update_interval = setInterval(update_shards, 5000);
      }

      function timeFormat(secs) {
        var str = "";
        var minutes = Math.floor(secs / 60);
        secs = secs % 60;
        var hours = Math.floor(minutes / 60);
        minutes = minutes % 60;
        return ((hours ? hours + "h" : "") +
                (minutes ? minutes + "m" : "") +
                secs + "s"
               );
      }

      function demo() {
        var num_shards = 4;
        var num_colls = 10;
        //var shards = [];
        var new_shards = [];
        for (var s = 0; s < num_shards; ++s) {
          var name = "shard-" + String.fromCharCode('a'.charCodeAt(0) + s);
          var shard = shards.find(function(s) { return s.get("name") == name });
          if (!shard) {
            shard = new Shard({
              name: name,
            });
          }
          new_shards.push(shard);
        }
        shards.reset(new_shards);

        shards.each(function(shard) {
          var from = shard.get("name") == migrating_from;
          var to = shard.get("name") == migrating_to;
          var new_collections = [];
          for (var i = 1; i <= num_colls; ++i) {
            var name = "collection-" + i;
            var coll = shard.get("collections").find(function(c) { return c.get("name") == name });
            if (!coll) {
              coll = new Collection({
                name: name,
                nchunks: 42,
              });
            }

            coll.set_migrating(migrating_coll, migrating_type, from, to, migrating_time);
            new_collections.push(coll);
          }
          shard.get("collections").reset(new_collections);
        });

        update_view(shards);

        ++nf;
        if (nf == 2) {
          nf = 0;
          migrating_type = migrating_type == "moveChunk.start" ? "moveChunk.commit" : "moveChunk.start";
          migrating_time = new Date();
          if (migrating_type == "moveChunk.start") {
            migrating_coll = shards.first().get("collections").at(Math.floor(Math.random() * shards.first().get("collections").length)).get("name");
            var shuffled_shards = shards.shuffle();
            migrating_from = shuffled_shards[0].get("name");
            migrating_to = shuffled_shards[1].get("name");
          }
        }
      }

      d3.select("#collapsed-nav").selectAll("li.version").data([
        "jQuery: " + $.fn.jquery,
        "d3: " + d3.version,
        "underscore: " + _.VERSION,
        "Backbone: " + Backbone.VERSION,
      ]).enter().append("li").attr("class", "version").
        append("a").append("small").text(function(d) { return d });

      if ($.QueryString.value("config_host") && $.QueryString.value("config_port")) {
        begin($.QueryString.value("config_host"), $.QueryString.value("config_port"));
      } else if ($.FragmentString.value("config_host") && $.FragmentString.value("config_port")) {
        begin($.FragmentString.value("config_host"), $.FragmentString.value("config_port"));
      } else {
        $("div#display").before("<div id='demo_header' class='row'><div class='span2'><h2>Demo</h2></div></div>");
        demo();
        demo_interval = setInterval(demo, 2000);
      }

      $("input#config_host").onEnterKey(function() {
        $("button#go").click();
      });
      $("input#config_port").onEnterKey(function() {
        $("button#go").click();
      });

      $("button#go").click(function() {
        var config_host = $("input#config_host").val();
        var config_port = $("input#config_port").val();
        history.pushState(
          {config_host: config_host, config_port: config_port},
          null,
          "?config_host=" + config_host + "&config_port=" + config_port
        );
        begin(config_host, config_port);
      });
    });
  });
