
use candle_core::{Tensor, DType, Device};
use candle_nn::VarBuilder;
use candle_transformers::models::segment_anything::sam;
use candle_transformers::models::segment_anything::sam::Sam;


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


pub struct SegmentAnything {
    device: Device,
    sam: Sam,
}

impl SegmentAnything {
    pub fn new() -> anyhow::Result<Self> {
        let args_cpu = false;
        let use_tiny = false;
        let model: Option<std::path::PathBuf> = None;
        let device = device(args_cpu)?;

        // let (image, initial_h, initial_w) = candle_examples::load_image(&args.image, Some(sam::IMAGE_SIZE))?;
        // let image = image.to_device(&device)?;
        // println!("loaded image {image:?}");

        let model = match model {
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
        Ok(Self{
            device,
            sam
        })
    }
}