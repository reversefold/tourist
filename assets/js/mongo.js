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

      var config_url;

      var requests = 0;
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
                var start = starts.slice(-1)[0];
                var migrating_type = start.what;
                var migrating_coll = start.ns.split('.').slice(1).join('.');
                var migrating_from = start.details.from;
                var migrating_to = start.details.to;
                var migrating_time = new Date(start.time['$date']);
                if (migrating_type == "moveChunk.commit" && (new Date() - migrating_time) > 60000) {
                  migrating_type = '';
                  migrating_coll = '';
                  migrating_from = '';
                  migrating_to = '';
                  migrating_time = '';
                }
              } else {
                var migrating_type = '';
                var migrating_coll = '';
                var migrating_from = '';
                var migrating_to = '';
                var migrating_time = '';
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
                  var shards = [];
                  _.each(shards_data.rows, function(row) {
                    var shard = {
                      name: row._id,
                      host: row.host,
                      collections: [],
                      chunks: shard_chunks[row._id],
                    };

                    collection_names = [];
                    _.each(shard.chunks, function(chunk) {
                      name = chunk.ns.split('.').slice(1).join('.');
                      num = collection_names[name];
                      if (num == undefined) {
                        num = 0;
                      }
                      collection_names[name] = num + 1;
                    });

                    for (var name in collection_names) {
                      coll = {
                        name: name,
                        nchunks: collection_names[name],
                      };
                      if (name == migrating_coll) {
                        var from = shard.name == migrating_from;
                        var to = shard.name == migrating_to;
                        if (from || to) {
                          coll.migrating = true;
                          coll.migrating_type = migrating_type;
                          coll.migrating_role = from ? "from" : (to ? "to" : "?");
                          coll.migrating_time = migrating_time;
                        }
                      }
                      shard.collections.push(coll);
                    }
                    shards.push(shard);
                  });

                  update_view(shards);
                });
            });
          },
        });
      }

      function update_view(shards) {
        shards.sort(function(a, b) { return a.name > b.name });
        _.each(shards, function(shard) {
          shard.collections.sort(function(a, b) {
            return (a.migrating == b.migrating
                    ? a.name.localeCompare(b.name)
                    : ((b.migrating ? 1 : 0) - (a.migrating ? 1 : 0)));
          });
        });

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

        var shard = svg.selectAll("g.shard").data(shards, function(d) { return d.name });

        shard.select("rect.shard");
        shard.select("text");

        var shard_g = shard.enter().append("g").
          attr("class", "shard").
          attr("transform", function(d, i) { return "translate(" + (10 + i * 310) + ",10)"})
        ;

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
            computed_height = d.collections.length * 60 + 10;
            max_height = Math.max(max_height, computed_height);
            return Math.max(500, computed_height);
          })
        ;

        svg.attr("height", max_height + 30);

        shard_g.append("text").
          attr("x", 10)
        ;

        shard_g.selectAll("text").
          text(function(d) { return d.name })
        ;

        shard.exit().remove();

        var colls = shard.selectAll("g.collection").
          data(function(d) { return d.collections }, function(d) { return d.name })
        ;

        colls.select("rect.collection");
        colls.select("text.name");
        colls.select("text.nchunks");
        colls.select("text.migration");
        colls.select("text.migrationAgo");

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

        colls.selectAll("rect.collection").
          transition().
          duration(750).
          style("fill", function(d) { return d.migrating ? (d.migrating_type == "moveChunk.start" ? "#FFFF88" : "#88FF88") : "#8888FF" })
        ;

        colls_g.append("text").
          attr("class", "name").
          attr("x", 10).
          attr("y", 20)
        ;

        colls.selectAll("text.name").
          text(function(d) { return d.name })
        ;

        colls_g.append("text").
          attr("class", "nchunks").
          attr("x", 10).
          attr("y", 40)
        ;

        colls.selectAll("text.nchunks").
          text(function(d) { return "chunks: " + d.nchunks })
        ;

        colls_g.append("text").
          attr("class", "migrationAgo").
          attr("x", 210).
          attr("y", 30)
        ;

        colls.selectAll("text.migrationAgo").
          text(function(d) {
            return (d.migrating ?
                    (Math.floor((new Date() - d.migrating_time) / 1000) + "s ago")
                   : "");
          })
        ;

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
          duration(750).
          attr("x", function(d) { return d.migrating_role == "from" ? 180 : 130 })
        ;
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
      }

      var update_interval;
      var demo_interval;

      function begin(config_host, config_port) {
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

      var migrating_type = "moveChunk.commit";
      var mig_coll;
      var shards_shuffled;
      var mig_from;
      var mig_to;
      var migrating_time;
      var nf = 1;

      function demo() {
        var num_shards = 4;
        var num_colls = 10;
        var shards = [];
        for (var s = 0; s < num_shards; ++s) {
          shards.push({
            name: "shard-" + String.fromCharCode('a'.charCodeAt(0) + s),
            collections: [],
          });
        }
        for (var i = 1; i <= num_colls; ++i) {
          _.each(shards, function(shard) {
            var coll = {
              name: "collection-" + i,
              nchunks: 42,
            };
            if (i == mig_coll) {
              var from = shard.name == mig_from;
              var to = shard.name == mig_to;
              if (from || to) {
                coll.migrating = true;
                coll.migrating_type = migrating_type;
                coll.migrating_role = from ? "from" : (to ? "to" : "?");
                coll.migrating_time = migrating_time;
              }
            }
            shard.collections.push(coll);
          });
        }
        update_view(shards);
        ++nf;
        if (nf == 2) {
          nf = 0;
          migrating_type = migrating_type == "moveChunk.start" ? "moveChunk.commit" : "moveChunk.start";
          if (migrating_type == "moveChunk.start") {
            mig_coll = Math.floor(Math.random() * num_colls) + 1;
            shards_shuffled = _.shuffle(shards);
            mig_from = shards_shuffled[0].name;
            mig_to = shards_shuffled[1].name;
            migrating_time = new Date();
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

      /*
      var Shard = Backbone.Model.extend({
        defaults: function() {
          return {
            name: '<unnamed>',
            collections: [],
          };
        }
      });

      var Collection = Backbone.Model.extend({
        defaults: function() {
          return {
            name: '<unnamed>',
            documents: 0,
          };
        }
      });

      var ShardsList = Backbone.Collection.extend({
        model: Shard,
      });

      //var shards = new ShardsList();
      */

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
