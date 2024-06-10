use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::segment_anything::sam;
use candle_transformers::models::segment_anything::sam::Sam;
use serde::{Deserialize, Serialize};

pub fn device(cpu: bool) -> anyhow::Result<Device> {
    use candle_core::utils::{cuda_is_available, metal_is_available};
    if cpu {
        Ok(Device::Cpu)
    } else if cuda_is_available() {
        Ok(Device::new_cuda(0)?)
    } else if metal_is_available() {
        Ok(Device::new_metal(0)?)
    } else {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            println!(
                "Running on CPU, to run on GPU(metal), build this example with `--features metal`"
            );
        }
        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            println!("Running on CPU, to run on GPU, build this example with `--features cuda`");
        }
        Ok(Device::Cpu)
    }
}

pub fn load_image(
    img: image::DynamicImage,
    resize_longest: Option<usize>,
) -> anyhow::Result<(Tensor, usize, usize)> {
    let (initial_h, initial_w) = (img.height() as usize, img.width() as usize);
    let img = match resize_longest {
        None => img,
        Some(resize_longest) => {
            let (height, width) = (img.height(), img.width());
            let resize_longest = resize_longest as u32;
            let (height, width) = if height < width {
                let h = (resize_longest * height) / width;
                (h, resize_longest)
            } else {
                let w = (resize_longest * width) / height;
                (resize_longest, w)
            };
            img.resize_exact(width, height, image::imageops::FilterType::CatmullRom)
        }
    };
    let (height, width) = (img.height() as usize, img.width() as usize);
    let img = img.to_rgb8();
    let data = img.into_raw();
    let data = Tensor::from_vec(data, (height, width, 3), &Device::Cpu)?.permute((2, 0, 1))?;
    Ok((data, initial_h, initial_w))
}

pub fn load_image_path<P: AsRef<std::path::Path>>(
    p: P,
    resize_longest: Option<usize>,
) -> anyhow::Result<(Tensor, usize, usize)> {
    let img = image::io::Reader::open(p)?
        .decode()
        .map_err(candle_core::Error::wrap)?;
    load_image(img, resize_longest)
}

pub struct SegmentAnything {
    device: Device,
    sam: Sam,
}

#[derive(Serialize, Deserialize, Debug, Copy, Clone, Eq, PartialEq)]
pub enum Category {
    Include,
    Exclude,
}
impl Category {
    pub fn as_bool(&self) -> bool {
        *self == Category::Include
    }
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

pub struct SegmentResult {
    pub image: Vec<u8>,
}

impl SegmentAnything {
    pub fn new() -> anyhow::Result<Self> {
        let args_cpu = false;
        let use_tiny = false;
        let sam_model: Option<std::path::PathBuf> = None;
        let device = device(args_cpu)?;

        // let (image, initial_h, initial_w) = candle_examples::load_image(&args.image, Some(sam::IMAGE_SIZE))?;
        // let image = image.to_device(&device)?;
        // println!("loaded image {image:?}");

        let model = match sam_model {
            Some(model) => std::path::PathBuf::from(model),
            None => {
                let api = hf_hub::api::sync::Api::new()?;
                let api = api.model("lmz/candle-sam".to_string());
                let filename = if use_tiny {
                    "mobile_sam-tiny-vitt.safetensors"
                } else {
                    "sam_vit_b_01ec64.safetensors"
                };
                api.get(filename)?
            }
        };
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[model], DType::F32, &device)? };
        let sam = if use_tiny {
            sam::Sam::new_tiny(vb)? // tiny vit_t
        } else {
            sam::Sam::new(768, 12, 12, &[2, 5, 8, 11], vb)? // sam_vit_b
        };
        Ok(Self { device, sam })
    }

    pub fn segment(
        &self,
        image_bytes: &[u8],
        threshold: f64,
        points: &[Point],
    ) -> anyhow::Result<SegmentResult> {
        use image::io::Reader;
        use std::io::Cursor;

        let img = Reader::new(Cursor::new(image_bytes))
            .with_guessed_format()
            .expect("Cursor io never fails")
            .decode()?;
        let (image, _initial_h, _initial_w) = load_image(img.clone(), Some(sam::IMAGE_SIZE))?;
        let image = image.to_device(&self.device)?;

        let points = points
            .iter()
            .map(|p| (p.x, p.y, p.category.as_bool()))
            .collect::<Vec<_>>();
        let start_time = std::time::Instant::now();
        let (mask, iou_predictions) = self.sam.forward(&image, &points, false)?;
        println!(
            "mask generated in {:.2}s",
            start_time.elapsed().as_secs_f32()
        );
        println!("mask:\n{mask}");
        println!("iou_predictions: {iou_predictions}");

        let mask = (mask.ge(threshold)? * 255.)?;
        let (_one, h, w) = mask.dims3()?;
        let mask = mask.expand((3, h, w))?;

        let mask_pixels = mask.permute((1, 2, 0))?.flatten_all()?.to_vec1::<u8>()?;
        let mask_img: image::ImageBuffer<image::Rgb<u8>, Vec<u8>> =
            match image::ImageBuffer::from_raw(w as u32, h as u32, mask_pixels) {
                Some(image) => image,
                None => anyhow::bail!("error saving merged image"),
            };

        let mut mask_img_mask = image::DynamicImage::from(mask_img.clone()).to_rgba8();
        for x in 0..mask_img_mask.width() {
            for y in 0..mask_img_mask.height() {
                let mask_p = mask_img_mask.get_pixel_mut(x, y);
                if mask_p.0[0] < 100 {
                    mask_p.0[3] = 0;
                }
            }
        }

        let mut mask_bytes: Vec<u8> = Vec::new();
        mask_img_mask.write_to(&mut Cursor::new(&mut mask_bytes), image::ImageFormat::Png)?;
        let res = SegmentResult { image: mask_bytes };
        Ok(res)
    }
}
