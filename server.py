#!/usr/bin/env python3

import cherrypy
import os
import sys
import json
import glob
import yaml
import copy
import argparse
# from cherrypy.lib import file_generator
import io

curdir = os.path.join(os.getcwd(), os.path.dirname(__file__)) 

#https://stackoverflow.com/a/36584863
def extend_dict(extend_me, extend_by):
    if isinstance(extend_by, dict):
        for k, v in extend_by.items():
            if k in extend_me:
                extend_dict(extend_me.get(k), v)
            else:
                extend_me[k] = v
    else:
        extend_me += extend_by

class Image:
    def __init__(self, path, config):
        self.config = config
        self.path = path

    def __repr__(self):
        return "<{} - ({})>".format(self.path[-50:], ", ".join([x["label"] for x in self.config["classes"]]))

    def get_info(self):
        return {"path":self.path, "config":self.config}

    def get_mime(self):
        mimes = {
            "png": "image/png",
            "jpg": "image/jpg"
        }
        return mimes[self.path[self.path.rindex('.')+1:]]

    def get_data(self):
        with open(self.path, "rb") as f:
            return f.read()
        

class Data:
    def __init__(self, path):
        self.path = path
        self.update_data()

    """
        Recursive functions that combines yaml files from each directory into one context that specifies classes.
        If it encounters a data file it creates an Image object with the current context.
    """
    @staticmethod
    def data_loader(path, context):
        entries = []
        yamlfiles = glob.glob(os.path.join(path, "*.yaml"))
        for yaml_fname in yamlfiles:
            print("Yamlfile: {}".format(yaml_fname))
            yaml_path = os.path.join(path, yaml_fname)
            with open(yaml_path, 'r') as f:
                try:
                    extend_dict(context, yaml.load(f))
                    # context.update(yaml.load(f))
                except yaml.YAMLError as exc:
                    print("Failed parsing {}: {}".format(yaml_path, selfexc))
        for content_fname in glob.glob(os.path.join(path, "*.*")):
            if (content_fname.endswith("yaml")):
                continue
            content_path = os.path.join(path, content_fname)
            # print("Content file: {}, properties: {}".format(cf, str(context)))
            entries.append(Image(content_path, context))
        for root, dirs, files in os.walk(path):
            for d in dirs:
                entries.extend(Data.data_loader(os.path.join(path, d), copy.deepcopy(context)))
        return entries

    """
        Returns information about the extent of the data.
    """
    def data_extent(self):
        return {"entries":len(self.entries)}

    def update_data(self):
        self.entries = self.data_loader(self.path, {})

    def entry_info(self, v):
        return self.entries[v].get_info()

    def entry_data(self, v):
        entry = self.entries[v]
        return entry.get_mime(), entry.get_data()


class Web(object):

    def __init__(self, data):
        self.data = data
        cherrypy.engine.subscribe("stop", self.stop)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def info_data_extent(self):
        return self.data.data_extent()

    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def entry_info(self, entry):
        return self.data.entry_info(int(entry))

    
    @cherrypy.expose
    def entry_data(self, entry):
        mime, data = self.data.entry_data(int(entry))
        cherrypy.response.headers['Content-Type'] = mime
        buffer = io.BytesIO(data)
        return cherrypy.lib.file_generator(buffer)

    def stop(self):
        # lets try to kill all handlers.
        print("Closing down.")


def start_classification_server(http_port, http_host, data):
    # set cherrypy configuration.
    cherrypy.config.update({"server.socket_port": http_port})
    cherrypy.config.update({"server.socket_host": http_host})

    web_root = Web(data)

    cherrypy.quickstart(web_root, "/", config={
        "/": {"tools.staticdir.on": True,
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
                        default=8080)
    parser.add_argument('--host', '-l',
                        help="The interface on which to listen.",
                        type=str,
                        default="127.0.0.1")
    parser.add_argument('--dir', '-d', help="Folder which holds the to be classified stuff.", type=str,
                        default=os.path.join(curdir, "classification_test"))

    args = parser.parse_args()
    data = Data(args.dir)
    print(data.entries)
    
    

    start_classification_server(1337, "127.0.0.1", data)
