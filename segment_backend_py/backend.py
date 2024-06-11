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

SAM_LOOKUP = {
    "sam_vit_b_01ec64.pth": "vit_b",
}

from segment_anything import SamPredictor, sam_model_registry
import numpy as np
from PIL import Image
from io import BytesIO
import torchvision.transforms.functional as transform
import torchvision
class Segmenter:
    def __init__(self, model_file):
        filename = os.path.basename(model_file)
        model_type = SAM_LOOKUP[filename]
        checkpoint = model_file

        self.sam = sam_model_registry[model_type](checkpoint=checkpoint)
        self.sam.to(device='cuda')
        self.predictor = SamPredictor(self.sam)

    @staticmethod
    def read_file_from_disk(p):
        with open(p, "rb") as f:
            return f.read()

    def update_image(self, image):
        # The image comes in as a byte string... 
        img_buffer = BytesIO(image)
        img = Image.open(img_buffer)
        # img_tensor = transform.to_tensor(img)
        # print(img_tensor.shape)
        self.predictor.set_image(np.array(img))

    def predict(self, points_with_labels, multimask_output=False):
        input_point = np.array([p[0] for p in points_with_labels])
        input_label = np.array([p[1] for p in points_with_labels])
        masks, scores, logits = self.predictor.predict(
            point_coords=input_point,
            point_labels=input_label,
            multimask_output=multimask_output,
        )
        return (masks, scores, logits)

        
    

class Web:
    def __init__(self, segmenter):
        self.segmenter = segmenter

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


def start_backend_server(http_port, http_host, model_pth):
    # set cherrypy configuration.
    cherrypy.config.update({"server.socket_port": http_port})
    cherrypy.config.update({"server.socket_host": http_host})

    caching_segmenter = Segmenter(model_pth)

    web_root = Web(caching_segmenter)
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

def run_host(args):
    start_backend_server(args.port, args.host, args.pth)

def run_sam(args):
    segmenter = Segmenter(args.pth)
    img_data = Segmenter.read_file_from_disk(args.file)
    segmenter.update_image(img_data)
    point = tuple(int(v) for v in args.point.split(","))
    mask, scores, logits = segmenter.predict([(point, 1)], multimask_output=False)
    print(mask)

    def img_frombytes(data):
        size = data.shape[::-1]
        databytes = np.packbits(data, axis=1)
        return Image.frombytes(mode='1', size=size, data=databytes)
    print(mask.shape)
    img = img_frombytes(mask.squeeze())
    img.save(args.output)

    # new_PIL_image = transform.to_pil_image(masks)
    # new_PIL_image.save(args.output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="A segment anything backend.")
    parser.add_argument('--pth', help="The pth file to load, by default read from SAM_PTH, which currently is: %(default)s", default=os.environ.get("SAM_PTH"))

    subparsers = parser.add_subparsers(dest="command")

    sam_parser = subparsers.add_parser('sam')
    sam_parser.add_argument('file', help="The image file to open.")
    sam_parser.add_argument('point', help="The x,y of the point we're working on.")
    sam_parser.add_argument('--output', help="The output file, defaults to %(default)s.", default="/tmp/mask.png")
    sam_parser.set_defaults(func=run_sam)

    host_parser = subparsers.add_parser('host')
    host_parser.add_argument('--port', '-p',
                        help="The port used to listen.",
                        type=int,
                        default=8081)
    host_parser.add_argument('--host', '-l',
                        help="The interface on which to listen.",
                        type=str,
                        default="127.0.0.1")
    host_parser.add_argument('pth', help="Path to the pth.", type=str)
    host_parser.set_defaults(func=run_host)

    args = parser.parse_args()

    # no command
    if (args.command is None):
        parser.print_help()
        parser.exit()

    args.func(args)