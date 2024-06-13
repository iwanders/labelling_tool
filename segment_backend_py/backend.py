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
import hashlib
import base64
import cv2


class Segmenter:
    def __init__(self, model_file):
        filename = os.path.basename(model_file)
        model_type = SAM_LOOKUP.get(filename, None)
        if model_type is None:
            raise Exception("Could not determine model type from the filename.")
        checkpoint = model_file
        print(f"Determined model type: {model_type} from {filename}")

        print("Loading model... ", end="", flush=True)
        self.sam = sam_model_registry[model_type](checkpoint=checkpoint)
        self.sam.to(device='cuda')
        self.predictor = SamPredictor(self.sam)
        print(" done!")

        self.current_file_hash = None

    @staticmethod
    def read_file_from_disk(p):
        with open(p, "rb") as f:
            return f.read()

    @staticmethod
    def hash_bytes(b):
        return hashlib.sha256(b).hexdigest()

    @staticmethod
    def mask_to_image(data):
        data = data.squeeze()
        size = data.shape[::-1]
        databytes = np.packbits(data, axis=1)
        return Image.frombytes(mode='1', size=size, data=databytes)


    def update_image(self, image_bytes):
        # Embeddings takes most of the time, so we check if we need to do it again, or whether
        # this is still the active file.
        new_hash = Segmenter.hash_bytes(image_bytes)
        if self.current_file_hash == new_hash:
            return

        # The image comes in as a bytes, so we make it into an image here:
        img_buffer = BytesIO(image_bytes)
        img = Image.open(img_buffer)

        # Ensure the image is rgb, otherwise the predictor gives odd errors;
        # https://github.com/facebookresearch/segment-anything/issues/413
        img = img.convert('RGB')

        # Then pass that to the predictor.
        self.predictor.set_image(np.array(img))

        # And update the current hash.
        self.current_file_hash = new_hash

    def set_threshold(self, threshold):
        self.predictor.model.mask_threshold = threshold

    def predict(self, points_with_labels, multimask_output=False):
        input_point = np.array([p[0] for p in points_with_labels])
        input_label = np.array([p[1] for p in points_with_labels])
        masks, scores, logits = self.predictor.predict(
            point_coords=input_point,
            point_labels=input_label,
            multimask_output=multimask_output,
        )
        return (masks, scores, logits)

    
    @staticmethod
    def mask_to_bw_img(mask):
        return mask.astype(np.uint8).squeeze()

    @staticmethod
    def create_contours(mask):
        print(mask)
        print(type(mask))
        bw_img = Segmenter.mask_to_bw_img(mask)
        print(bw_img.shape)
        print("contour start")
        # contours, other = cv2.findContours(bw_img, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        contours, other = cv2.findContours(bw_img, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_L1)
        # contours, other = cv2.findContours(bw_img, cv2.RETR_TREE, cv2.CHAIN_APPROX_TC89_KCOS)
        print(contours)
        print(other)
        print("contour end")
        for i, contour in enumerate(contours):
            area = cv2.contourArea(contour)
            print(f"Contour: {area}: {contour}")
            blank_image = np.zeros(bw_img.shape, np.uint8)
            cv2.fillPoly(blank_image, pts=[contour], color= (255,255,255))
            # plt.imshow(blank_image)
            cv2.imwrite(f"/tmp/contour_{i}.png", blank_image)
    

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
        """
            #[derive(Deserialize, Serialize, Debug, Clone)]
            struct SegmentPayload {
                /// The points of interest to segment with.
                points: Vec<segment::Point>,
                /// The data representing the image (base64 string on the wire).
                #[serde(deserialize_with = "deserialize_base64_string")]
                #[serde(serialize_with = "serialize_base64_string")]
                image: Vec<u8>,
                /// The threshold to use.
                #[serde(default)]
                threshold: f64,
            }
            #[derive(Serialize, Deserialize, Debug, Copy, Clone)]
            pub struct Point {
                /// The horizontal position in normalised coordinates [0, 1.0]
                x: f64,
                /// The vertical position in normalised coordinates [0, 1.0]
                y: f64,
                /// Wether this point depicts and include or an exclude.
                category: Category,
            }
        """
        # create the actual points to pass to predict.
        #[(point, 1)]
        points = []
        for p in input_json["points"]:
            foreground = 1 if p["category"] == "Include" else 0;
            points.append(((p["x"], p["y"]), foreground))

        print(points)
        if len(points) == 0:
            # SAM fails with a backtrace in this case... so lets prevent that.
            input_json["image"] = ""
            return input_json
            

        # Obtain the image bytes.
        img_data = base64.b64decode(input_json["image"])

        # Pass the img data to the segmenter
        self.segmenter.update_image(img_data)

        # Set the threshold
        self.segmenter.set_threshold(input_json["threshold"])

        # Next, run the prediction
        mask, scores, logits = self.segmenter.predict(points, multimask_output=False)

        # Create contours from this mask.
        contours = Segmenter.create_contours(mask)

        # Convert the mask to an image
        mask = Segmenter.mask_to_image(mask)

        # Now we have an image, we need to use that to mask in a transparent png.
        color_of_mask = (255, 255, 255)
        mask_image = Image.new("RGB", (mask.width, mask.height), color_of_mask)
        mask_image.putalpha(mask)

        # Convert the image to png bytes
        buffer = BytesIO()
        mask_image.save(buffer, format="png")
        mask_png = buffer.getvalue()


        with open("/tmp/pngmask.png", "wb") as f:
            f.write(mask_png)
        # Make that into a base64 encoded string
        mask_png_b64 = base64.b64encode(mask_png)
        
        input_json["image"] = mask_png_b64.decode("ascii")

        return input_json


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
    contour = Segmenter.create_contours(mask)
    img = Segmenter.mask_to_image(mask)
    img.save(args.output)




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
    host_parser.set_defaults(func=run_host)

    args = parser.parse_args()

    # no command
    if (args.command is None):
        parser.print_help()
        parser.exit()

    args.func(args)