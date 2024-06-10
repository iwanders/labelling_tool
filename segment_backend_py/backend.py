#!/usr/bin/env python3

# The MIT License (MIT)
# Copyright (c) 2018 Ivor Wanders
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import cherrypy
import os
import sys
import argparse
import cherrypy_cors
cherrypy_cors.install()

curdir = os.path.join(os.getcwd(), os.path.dirname(__file__)) 

class Web(object):
    def __init__(self, data):
        self.data = data

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def sam_trigger(self, *args, **kwargs):
        if cherrypy.request.method == 'OPTIONS':
            # This is a request that browser sends in CORS prior to
            # sending a real request.

            # Set up extra headers for a pre-flight OPTIONS request.
            cherrypy_cors.preflight(allowed_methods=['GET', 'POST'])
            return {}

        input_json = cherrypy.request.json
        
        return {}


    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def present(self, *args, **kwargs):
        return {}


def start_backend_server(http_port, http_host, data):
    # set cherrypy configuration.
    cherrypy.config.update({"server.socket_port": http_port})
    cherrypy.config.update({"server.socket_host": http_host})

    web_root = Web(data)
    cherrypy.quickstart(web_root, "/", config={
        "/": {"tools.staticdir.on": True,
            'cors.expose.on': True,
            "tools.staticdir.dir": os.path.join(curdir, "static"),
            "tools.staticdir.index": "index.html",
            'tools.staticdir.content_types' : {
                'js': 'application/javascript;charset=utf-8', 
                'css': 'text/css;charset=utf-8', 
                'html': 'text/html;charset=utf-8'} # utf8 necessary for ol.
            },
    })




if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Classification server webinterface.")
    parser.add_argument('--port', '-p',
                        help="The port used to listen.",
                        type=int,
                        default=8081)
    parser.add_argument('--host', '-l',
                        help="The interface on which to listen.",
                        type=str,
                        default="127.0.0.1")
    parser.add_argument('pth', help="Path to the pth.", type=str)

    args = parser.parse_args()
    start_backend_server(args.port, args.host, args.pth)
