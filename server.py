#!/usr/bin/env python3

import cherrypy
import os
import sys

curdir = os.path.join(os.getcwd(), os.path.dirname(__file__)) 

class Root(object):

    def __init__(self):
        cherrypy.engine.subscribe("stop", self.stop)

    @cherrypy.expose
    def foo(self):
        # pass
        print("Foo is executed")
    foo._cp_config = {"tools.staticdir.on": False}

    def stop(self):
        # lets try to kill all handlers.
        print("Closing down.")


def start_classification_server(http_port, http_host, htdocs_path):
    # set cherrypy configuration.
    cherrypy.config.update({"server.socket_port": http_port})
    cherrypy.config.update({"server.socket_host": http_host})

    web_root = Root()

    cherrypy.quickstart(web_root, "/", config={
        "/": {"tools.staticdir.on": True,
                "tools.staticdir.dir": os.path.join(htdocs_path, "static"),
                "tools.staticdir.index": "index.html",
                'tools.staticdir.content_types' : {
                    'js': 'application/javascript;charset=utf-8', 
                    'css': 'text/css;charset=utf-8', 
                    'html': 'text/html;charset=utf-8'} # utf8 necessary for ol.
                },
        })


if __name__ == "__main__":
    start_classification_server(1337, "127.0.0.1", curdir)
