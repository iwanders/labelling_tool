
## Rust backend
Originally, this was the first segment anything backend I explored, but has some quirks around the resolution being very low, I didn't really have time to explore this as I needed things to work, so this is pretty much dead code. I may revisit this if time allows to figure out how to use candle to do a higher resolution segment anything, it's probably something around creating the embeddings for the image first.


The `segment_backend_rs` directory holds a simple backend server that runs the Segment Anything model through candle, this currently produces different results than the python implementation.

Start it with `cargo r --features=cuda --release`, after which segmentation masks can be created from the points in the current category.

If the segmentation backend is not running this functionality is hidden.
