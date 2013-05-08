Tourist
=======

Visualizes MongoDB data migration in a sharded cluster. JavaScript and HTML only, with [d3.js](http://d3js.org/), [require.js](http://requirejs.org/), [jQuery](https://jquery.org/), [underscore.js](http://underscorejs.org/), and [Bootstrap](http://twitter.github.io/bootstrap/). No server-side component required.

You will need a hostname and port of one of your config database servers which has the `rest` and `jsonp` options turned on. If you have authentication set up you'll also need a username and password in the admin database.

That's it! Go to [Tourist](http://reversefold.github.io/tourist/), enter your config server host and port, and watch as chunks get migrated.

Note that the application itself doesn't take your credentials, this is handled by your browser so authentication is entirely within your own control.