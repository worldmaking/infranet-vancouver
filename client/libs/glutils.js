
(function() {
    const isCommonjs = typeof module !== 'undefined' && module.exports;
    
    
    const assert = console.assert

    const lib = {
        createFBO: createFBO,
        createPixelTexture: createPixelTexture,
        createProgram: createProgram,
        createQuadVao: createQuadVao,
        createShader: createShader,
        createSlab: createSlab,
        createTexture: createTexture,
        createVao: createVao,
        geomFromOBJ: geomFromOBJ,
        makeQuad: makeQuad,
        makeQuadWithDivisions: makeQuadWithDivisions,
        makeCube: makeCube,
        loadTexture: loadTexture,
        makeBuffer: makeBuffer,
        makeFboWithDepth: makeFboWithDepth,
        makeOffscreenCanvas: makeOffscreenCanvas,
        makeProgram: makeProgram,
        makeProgramFromCode: makeProgramFromCode,
        quat_rotate: quat_rotate,
        quat_unrotate: quat_unrotate,
        uniformsFromCode: uniformsFromCode,

        glsl_version_string: "#version 300 es",
    };  

    
    function makeOffscreenCanvas(width, height) {
        // in node.js:
        //const canvas = new OffscreenCanvas(width, height)
        // in browser:
        const canvas = document.createElement("canvas");
        canvas.width = width; 
        canvas.height = height;

        return canvas;
    }

    // utility to help turn shader code into a shader object:
    function createShader(gl, type, source) {
        let shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        let success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (success) {
            return shader;
        }
        console.error("shader compile error", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return undefined;
    }
    
    // utility to turn shader objects into a GPU-loaded shader program
    // uses the most common case a program of 1 vertex and 1 fragment shader:
    function createProgram(gl, vertexShader, fragmentShader) {
        let program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        let success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (success) {
            return program;
        }
        console.error("shader program error", gl.getProgramInfoLog(program));  
        gl.deleteProgram(program);
        return undefined;
    }

    function makeProgram(gl, vertexCode, fragmentCode) {
        // create GLSL shaders, upload the GLSL source, compile the shaders
        let vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
        let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
        // Link the two shaders into a program
        let program = createProgram(gl, vertexShader, fragmentShader);
        
        let uniforms = {}
        uniformsFromCode(gl, program, vertexCode, uniforms)
        uniformsFromCode(gl, program, fragmentCode, uniforms)
        return {
            id: program,
            begin: function() { gl.useProgram(program); return this; },
            end: function() { gl.useProgram(null); return this; },
            uniform: function(name, x, y, z, w) {
                uniforms[name].set(x, y, z, w);
                return this; 
            },
            uniforms: uniforms,
        }
    }

    // combine above functions to create a program from GLSL code:
    function makeProgramFromCode(gl, vertexCode, fragmentCode) {
        // create GLSL shaders, upload the GLSL source, compile the shaders
        let vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
        let fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
        // Link the two shaders into a program
        return createProgram(gl, vertexShader, fragmentShader);
    }

    function uniformsFromCode(gl, program, code, uniforms = {}) {
        const regex = /uniform\s+(\w+)\s+(\w+)/g;
        let match
        while (match = regex.exec(code)) {
            let type = match[1];
            let name = match[2];
            let location = gl.getUniformLocation(program, name);
            let setter;
            switch (type) {
                case "float": setter = (v) => gl.uniform1f(location, v); break;
                case "vec2": setter = (v) => gl.uniform2f(location, v[0], v[1]); break;
                case "vec3": setter = (v) => gl.uniform3f(location, v[0], v[1], v[2]); break;
                case "vec4": setter = (v) => gl.uniform4f(location, v[0], v[1], v[2], v[3]); break;
                case "ivec2": setter = (v) => gl.uniform2i(location, v[0], v[1]); break;
                case "ivec3": setter = (v) => gl.uniform3i(location, v[0], v[1], v[2]); break;
                case "ivec4": setter = (v) => gl.uniform4i(location, v[0], v[1], v[2], v[3]); break;
                case "mat2": setter = (m, transpose=false) => gl.uniformMatrix2fv(location, transpose, m); break;
                case "mat3": setter = (m, transpose=false) => gl.uniformMatrix3fv(location, transpose, m); break;
                case "mat4": setter = (m, transpose=false) => gl.uniformMatrix4fv(location, transpose, m); break;
                default: setter = (i) => gl.uniform1i(location, i);
            }
            uniforms[name] = { 
                set: setter,
                name: name,
                type: type,
                location: location,
            };
        };
        return uniforms;
    }


    // create a GPU buffer to hold some vertex data:
    function makeBuffer(gl, vertices) {
        let buffer = gl.createBuffer();
        // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null); // done.
        return buffer;
    }


    function createTexture(gl, opt) {
        const EXT_color_buffer_float = isCommonjs ? true : !!gl.getExtension("EXT_color_buffer_float");
    
        const isFloat = opt.float && EXT_color_buffer_float;
        const channels = opt.channels || 4; // RGBA
        const width = opt.width || 16;
        const height = opt.height || 1;

        console.log("texture", isFloat, channels, width, height)

        let format = gl.RGBA;
        if (channels == 1) {
            format = gl.RED;
        } else if (channels == 2) {
            format = gl.LUMINANCE_ALPHA;
        } else if (channels == 3) {
            format = gl.RGB;
        }

        let internalFormat = format;
        let type = gl.UNSIGNED_BYTE;
        if (isFloat) {
            type = gl.FLOAT;
            if (channels == 1) {
                internalFormat = gl.R32F;
            } else if (channels == 2) {
                internalFormat = gl.RG32F;
            } else if (channels == 3) {
                internalFormat = gl.RGB32F;
            } else {	
                internalFormat = gl.RGBA32F;
            }
        }

        console.log(format, gl.RED);
        console.log(internalFormat, gl.R32F);

        let tex = {
            id: gl.createTexture(),
            data: null,
            isFloat: isFloat,
            width: width,
            height: height,
            channels: channels,
            format: format,
            type: type,
            filter_min: opt.filter_min || opt.filter || gl.NEAREST,
            filter_mag: opt.filter_mag || opt.filter || gl.NEAREST,
            internalFormat: internalFormat,  // type of data we are supplying,
            
            // allocate local data
            allocate() {
                if (!this.data) {
                    let elements = this.width * this.height * this.channels;
                    if (this.isFloat) {
                        this.data = new Float32Array(elements);
                    } else {
                        this.data = new Uint8Array(elements);
                    }
                }
                return this;
            },
            
            // bind() first
            submit() {
                let mipLevel = 0;
                let border = 0;                 // must be 0
                gl.texImage2D(gl.TEXTURE_2D, mipLevel, this.internalFormat, this.width, this.height, border, this.format, this.type, this.data);
                gl.generateMipmap(gl.TEXTURE_2D);
                assert(!gl.getError(), 'gl error in texture submit');
                return this;
            },
            
            bind(unit = 0) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, this.id);
                return this;
            },
            unbind(unit = 0) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);
                return this;
            },

            // TODO read / readInto methods for accessing underlying data
            read(pos) {
                let x = Math.floor(pos[0]);
                let y = Math.floor(pos[1]);
                let idx = (y*this.width + x) * this.channels; // TODO: assumes single-channel
                return this.data[idx];
            }
        };

        tex.allocate().bind().submit();

        // unless we get `OES_texture_float_linear` we can not filter floating point
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tex.filter_min);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tex.filter_mag);
        
        return tex.unbind();
    }

    function loadTexture(gl, url, flipY=false, premultiply=false) {

        let tex = {
            id: gl.createTexture(),
            data: null,
            width: 1,
            height: 1,
            channels: 4,
            format: gl.RGBA,
            dataType: gl.UNSIGNED_BYTE,

            bind(unit = 0) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, this.id);
                return this;
            },
            unbind(unit = 0) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);
                return this;
            },
        };
        
        gl.bindTexture(gl.TEXTURE_2D, tex.id);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    
        // Because images have to be download over the internet
        // they might take a moment until they are ready.
        // Until then put a single pixel in the texture so we can
        // use it immediately. When the image has finished downloading
        // we'll update the texture with the contents of the image.
        gl.texImage2D(gl.TEXTURE_2D, 0, tex.format, tex.width, tex.height, 0, tex.format, tex.dataType, new Uint8Array([0, 0, 0, 255]));
    
        const image = new Image();
        image.onload = function() {
            gl.bindTexture(gl.TEXTURE_2D, tex.id);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
            gl.texImage2D(gl.TEXTURE_2D, 0, tex.format, tex.format, tex.dataType, image);

            // WebGL1 has different requirements for power of 2 images
            // vs non power of 2 images so check if the image is a
            // power of 2 in both dimensions.
            if (utils.isPowerOf2(tex.width) && utils.isPowerOf2(tex.height)) {
                // Yes, it's a power of 2. Generate mips.
                gl.generateMipmap(gl.TEXTURE_2D);
            } else {
                // No, it's not a power of 2. Turn of mips and set
                // wrapping to clamp to edge
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
        };
        image.src = url;
    
        return tex;
    }

    function createPixelTexture(gl, width, height, floatingpoint=false, interpolate=false) {

        const EXT_color_buffer_float = isCommonjs ? true : !!gl.getExtension("EXT_color_buffer_float");
        const OES_texture_float_linear = isCommonjs ? true : !!gl.getExtension("OES_texture_float_linear");
        floatingpoint = floatingpoint && EXT_color_buffer_float;
        
        if (interpolate && floatingpoint) {
            interpolate = OES_texture_float_linear;
        }

        const channels = 4; // RGBA

        let tex = {
            id: gl.createTexture(),
            data: null,
            width: width,
            height: height,
            channels: channels,
            format: gl.RGBA,
            dataType: floatingpoint ? gl.FLOAT : gl.UNSIGNED_BYTE,  // type of data we are supplying,
            
            load(url) {
                if (!this.data) this.allocate();

                let self = this;
                const img = new Image();   // Create new img element
                const canvas = makeOffscreenCanvas(this.width, this.height); //new OffscreenCanvas(this.width, this.height);
                img.onload = function() {

                    // TODO: assert width/height match?
                    let ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0);
                    let imgdata = ctx.getImageData(0, 0, self.width, self.height);
                    let binary = new Uint8ClampedArray(imgdata.data.buffer);
                    let length = imgdata.data.length;
                    for (let i=0; i<length; i++) {
                        self.data[i*4+0] = (binary[i*4+0] / 255);
                        self.data[i*4+1] = (binary[i*4+1] / 255);
                        self.data[i*4+2] = (binary[i*4+2] / 255);
                        self.data[i*4+3] = (binary[i*4+3] / 255);
                    }
                    self.bind().submit();
                    // self.width = this.width;
                    // self.height = this.height;
                    // self.canvas.width = self.width;
                    // self.canvas.height = self.height;
                    // let length = self.width * self.height;
                    // let ctx = self.canvas.getContext("2d");
                    // ctx.drawImage(img, 0, 0);
                    // self.imgdata = ctx.getImageData(0, 0, self.width, self.height);
                    // let binary = new Uint8ClampedArray(self.imgdata.data.buffer);
                    // let data = new Float32Array(length*4);
                    // for (let i=0; i<length; i++) {
                    //     data[i*4+0] = (binary[i*4+0] / 255);
                    //     data[i*4+1] = (binary[i*4+1] / 255);
                    //     data[i*4+2] = (binary[i*4+2] / 255);
                    //     data[i*4+3] = (binary[i*4+3] / 255);
                    // }
                    // self.data = data;

                    // if (callback) callback.apply(self);
                }
                img.src = url; // Set source path
                return this;
            },

            // allocate local data
            allocate() {
                if (!this.data) {
                    let elements = width * height * channels;
                    if (floatingpoint) {
                        this.data = new Float32Array(elements);
                    } else {
                        this.data = new Uint8Array(elements);
                    }
                }
                return this;
            },
            
            // bind() first
            submit() {
                let mipLevel = 0;
                let internalFormat = floatingpoint ? gl.RGBA32F : gl.RGBA;   // format we want in the texture
                let border = 0;                 // must be 0
                gl.texImage2D(gl.TEXTURE_2D, mipLevel, internalFormat, this.width, this.height, border, this.format, this.dataType, this.data);
                gl.generateMipmap(gl.TEXTURE_2D);
                assert(!gl.getError(), "gl error creating mipmap");
                return this;
            },
            
            bind(unit = 0) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, this.id);
                return this;
            },
            unbind(unit = 0) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);
                return this;
            },

            read(x, y) {
                if (!this.data) return 0;
        
                let idx = 4*(Math.floor(x) + Math.floor(y) * this.width);
                return this.data[idx+1];
            },
        
            readInto(x, y, v) {
                if (this.data) {
                    let idx = 4*(Math.floor(x) + Math.floor(y) * this.width);
                    v[0] = this.data[idx];
                    v[1] = this.data[idx+1];
                    v[2] = this.data[idx+2];
                    v[3] = this.data[idx+3];
                }
                return v;
            },
        
            readDot(x, y, xyz) {
                if (!this.data) return 0;
                let idx = 4*(Math.floor(x) + Math.floor(y) * this.width);
                return this.data[idx] * xyz[0]
                    + this.data[idx+1] * xyz[1]
                    + this.data[idx+2] * xyz[2];
            },
        };

        tex.allocate().bind().submit();

        // unless we get `OES_texture_float_linear` we can not filter floating point
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, interpolate ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, interpolate ? gl.LINEAR : gl.NEAREST);
        assert(!gl.getError(), "error creating texture");
        
        return tex.unbind();
    }


    function createCheckerTexture(gl, texSize = 8) {
        // let texData = new Uint8Array(texSize * texSize * 4);
        // for (let i=0; i<texSize; i++) {
        //   for (let j=0; j<texSize; j++) {
        //     let idx = (i*texSize + j) * 4;
        //     let val = 255 * ((i + j) % 2);
        //     texData[idx+0] = val;
        //     texData[idx+1] = val;
        //     texData[idx+2] = val;
        //     texData[idx+3] = 255;
        //   }
        // }
        // let texture = gl.createTexture();
        // gl.bindTexture( gl.TEXTURE_2D, texture );
        // gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texSize, texSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, texData);
        // gl.generateMipmap( gl.TEXTURE_2D );
        // gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR );
        // gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

        let texture = createPixelTexture(gl, texSize, texSize);
        let texData = texture.data; //new Uint8Array(texSize * texSize * 4);
        for (let i=0; i<texSize; i++) {
            for (let j=0; j<texSize; j++) {
                let idx = (i*texSize + j) * 4;
                let val = 255 * ((i + j) % 2);
                texData[idx+0] = val;
                texData[idx+1] = val;
                texData[idx+2] = val;
                texData[idx+3] = 255;
            }
        }
        texture.bind().submit().unbind();
        
        return texture;
    }

    function makeFboWithDepth(gl, width=1024, height=1024) {
        const id = gl.createFramebuffer();
        const colorTexture = gl.createTexture();
        const depthTexture = gl.createTexture();
        {		
            gl.bindFramebuffer(gl.FRAMEBUFFER, id);
            
            // define size and format of level 0
            const level = 0;
            const border = 0;
            gl.bindTexture(gl.TEXTURE_2D, colorTexture);
            gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA,
                width, height, border,
                gl.RGBA, gl.UNSIGNED_BYTE, null);
            // set the filtering so we don't need mips
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_BORDER);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_BORDER);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, level);

            // depth texture
            gl.bindTexture(gl.TEXTURE_2D, depthTexture);
            gl.texImage2D(gl.TEXTURE_2D, level, gl.DEPTH_COMPONENT24,
                width, height, border,
                gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
            // set the filtering so we don't need mips
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_BORDER);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_BORDER);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, level);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        return {
            id: id,
            colorTexture: colorTexture,
            depthTexture: depthTexture,
            width: width,
            height: height,
        }
    }

    function createFBO(gl, width, height, floatingpoint=false, interpolate=false) {
        const multisamples = 1;
        let id = gl.createFramebuffer();

        let colorRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, colorRenderbuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, multisamples, gl.RGBA8, width, height);

        gl.bindFramebuffer(gl.FRAMEBUFFER, id);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorRenderbuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        let fbo = {
            id: id,
            width: width,
            height: height,
            floatingpoint: floatingpoint,

            // what we currently read from:
            front: createPixelTexture(gl, width, height, floatingpoint, interpolate),
            // what we currently draw to:
            back: createPixelTexture(gl, width, height, floatingpoint, interpolate),
            
            bind() { 
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.id); 

                //gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, gl.RBGA4, 256, 256);
                return this; 
            },
            clear(r=0, g=0, b=0, a=1) {
                gl.clearBufferfv(gl.COLOR, 0, [r, g, b, a]);
                return this; 
            },
            unbind() { 
                gl.bindFramebuffer(gl.FRAMEBUFFER, null); 
                return this; 
            },
            swap() {
                [this.back, this.front] = [this.front, this.back];
                return this;
            },
            begin() {
                // make this the framebuffer we are rendering to.
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.id);
                let attachmentPoint = gl.COLOR_ATTACHMENT0;
                let mipLevel = 0;               // the largest mip
                gl.framebufferTexture2D(gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, this.back.id, mipLevel);
                gl.viewport(0, 0, this.width, this.height);
                return this; 
            },
            
            end() {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                this.front.bind()
                gl.generateMipmap(gl.TEXTURE_2D); 
                this.front.unbind()
                this.swap();
                return this; 
            },

            blit(dstid) {
                // Blit framebuffers, no Multisample texture 2d in WebGL 2
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.id);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstid);
                //gl.clearBufferfv(gl.COLOR, 0, [0.0, 0.0, 0.0, 1.0]);
                gl.blitFramebuffer(
                    0, 0, this.front.width, this.front.height,
                    0, 0, this.front.width, this.front.height,
                    gl.COLOR_BUFFER_BIT, gl.NEAREST // NEAREST is the only valid option at the moment
                );
                return this;
            },

            // reads the GPU memory back into this.data
            // must bind() first!
            // warning: can be slow
            readPixels(attachment = gl.COLOR_ATTACHMENT0) {
                if (!this.front.data) this.front.allocate();
                gl.readBuffer(attachment);
                gl.readPixels(0, 0, this.front.width, this.front.height, this.front.format, this.front.dataType, this.front.data);
                return this;
            },
        };

        fbo.bind().swap().unbind();
        return fbo;
    }

    // geom should have vertices, normals, indices
    function createVao(gl, geom, program) {
        let indexType = gl.UNSIGNED_SHORT;
        if (geom.indices) {
            if (geom.indices instanceof Uint8Array || geom.indices instanceof Uint8ClampedArray) {
                indexType = gl.UNSIGNED_BYTE;
            } else if (geom.indices instanceof Uint32Array) {
                indexType = gl.UNSIGNED_INT;
            }
        }

        let self = {
            id: gl.createVertexArray(),
            geom: geom,
            program: program,
            indexType: indexType,
            attributes: {},

            init(program) {
                console.log(geom)
                gl.bindVertexArray(this.id);
                if (geom) {
                    if (geom.vertices) {
                        let vertexComponents = geom.vertexComponents ? geom.vertexComponents : 3;
                        this.setAttribute("a_position", gl.createBuffer(), vertexComponents, geom.vertices);
                    }
                    if (geom.colors) {
                        this.setAttribute("a_color", gl.createBuffer(), 4, geom.colors);
                    }
                    if (geom.normals) {
                        this.setAttribute("a_normal", gl.createBuffer(), 3, geom.normals);
                    }
                    if (geom.texCoords) {
                        this.setAttribute("a_texCoord", gl.createBuffer(), 2, geom.texCoords);
                    }
                    if (geom.indices) {
                        this.indexBuffer = gl.createBuffer();
                        // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
                        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
                        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.DYNAMIC_DRAW);
                    }
                }
                this.unbind();
            },

            // assumes Vao is bound
            // attributeName: the name of the attribute in the vertex program
            // buffer: the buffer as created by gl.createBuffer()
            // vertexComponents: how many components per vertex (e.g. 2D, 3D geometry)
            // data: the Float32Array to upload.        
            setAttribute(attributeName, buffer, vertexComponents=4, data=null) {
                // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

                // look up in the shader program where the vertex attributes need to go.
                let attrLoc = gl.getAttribLocation(this.program, attributeName);
                // Turn on the attribute
                gl.enableVertexAttribArray(attrLoc);
                // Tell the attribute how to get data out of buffer (ARRAY_BUFFER)
                let type = gl.FLOAT;   // the data is 32bit floats
                let normalize = false; // don't normalize the data
                let stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
                let offset = 0;        // start at the beginning of the buffer
                gl.vertexAttribPointer(attrLoc, vertexComponents, type, normalize, stride, offset);
                // done with buffer:
                gl.bindBuffer(gl.ARRAY_BUFFER, null);

                this.attributes[attributeName] = {
                    name: attributeName,
                    buffer: buffer,
                    type: type,
                    stride: stride,
                    offset: offset,
                    data: data,
                    attrLoc: attrLoc,
                };
                return this;
            },

            // assumes vao and buffer are already bound:
            setAttributes(buffer, bytestride, bufferFields, instanced) {
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                for (let field of bufferFields) {
                    let attrLoc = gl.getAttribLocation(this.program, field.name);
                    gl.enableVertexAttribArray(attrLoc);
                    const normalize = false;
                    gl.vertexAttribPointer(attrLoc, field.components, field.type, normalize, bytestride, field.byteoffset);
                    if (instanced) {
                        gl.vertexAttribDivisor(attrLoc, 1);
                    } else {
                        gl.vertexAttribDivisor(attrLoc, 0);
                    }

                    //console.log("set attr", field.name, attrLoc, instanced, bytestride, field.byteoffset)
                }
                return this;
            },

            bind() {
                gl.bindVertexArray(this.id);
                return this;
            },
            unbind() {
                gl.bindVertexArray(this.id, null);
                return this;
            },
            draw(count=0) {
                if (this.geom.indices) gl.drawElements(gl.TRIANGLES, count ? count : this.geom.indices.length, this.indexType, 0);
                else gl.drawArrays(gl.TRIANGLES, 0, count ? count : geom.vertices.length);
                return this;
            },
            drawLines(count=0) {
                if (this.geom.indices) gl.drawElements(gl.LINES, count ? count : this.geom.indices.length, this.indexType, 0);
                else gl.drawArrays(gl.LINES, 0, count ? count : geom.vertices.length);
                return this;
            },
            drawPoints(count = 0) {
                if (!count) {
                    if (geom.indices) count = geom.indices.length;
                    else if (geom.vertices) count = geom.vertices.length;
                    else count = 1;
                }
                gl.drawArrays(gl.POINTS, 0, count);
                return this;
            },
            drawInstanced(instanceCount=1) {
                if (this.geom.indices) gl.drawElementsInstanced(gl.TRIANGLES, this.geom.indices.length, this.indexType, 0, instanceCount);
                else gl.drawArraysInstanced(gl.TRIANGLES, 0, geom.vertices.length, instanceCount)
                return this;
            },
        }
        if (program) self.init(program);

        return self;
    }

    function createQuadVao(gl, program) {
        let self = {
            id: gl.createVertexArray(),
            init(program) {
                this.bind();
                {
                    let buffer = makeBuffer(gl, [
                        -1,  1,  -1, -1,   1, -1,
                        -1,  1,   1, -1,   1,  1
                    ]);
                    // look up in the shader program where the vertex attributes need to go.
                    let positionAttributeLocation = gl.getAttribLocation(program, "a_position");
                    // Turn on the attribute
                    gl.enableVertexAttribArray(positionAttributeLocation);
                    // Tell the attribute which buffer to use
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
                    let size = 2;          // 2 components per iteration
                    let type = gl.FLOAT;   // the data is 32bit floats
                    let normalize = false; // don't normalize the data
                    let stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
                    let offset = 0;        // start at the beginning of the buffer
                    gl.vertexAttribPointer(positionAttributeLocation, size, type, normalize, stride, offset);
                    // done with buffer:
                    gl.bindBuffer(gl.ARRAY_BUFFER, null);
                }
                {
                    let texcoordBuffer = makeBuffer(gl, [
                        0, 1,  0, 0,   1, 0,
                        0, 1,  1, 0,   1, 1
                    ]);
                    // look up in the shader program where the vertex attributes need to go.
                    let positionAttributeLocation = gl.getAttribLocation(program, "a_texCoord");
                    // Turn on the attribute
                    gl.enableVertexAttribArray(positionAttributeLocation);
                    // Tell the attribute which buffer to use
                    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
                    // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
                    let size = 2;          // 2 components per iteration
                    let type = gl.FLOAT;   // the data is 32bit floats
                    let normalize = false; // don't normalize the data
                    let stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
                    let offset = 0;        // start at the beginning of the buffer
                    gl.vertexAttribPointer(positionAttributeLocation, size, type, normalize, stride, offset);
                    // done with buffer:
                    gl.bindBuffer(gl.ARRAY_BUFFER, null);
                }
                this.unbind();
            },

            bind() {
                gl.bindVertexArray(this.id);
                return this;
            },
            unbind() {
                gl.bindVertexArray(this.id, null);
                return this;
            },
            draw(primitiveType = gl.TRIANGLES, count = 6) {
                // draw
                let offset = 0;
                gl.drawArrays(primitiveType, offset, count);
                return this;
            }
        }
        if (program) self.init(program);

        return self;
    }

    function createSlab(gl, fragCode, uniforms) {
        let vertCode = `${lib.glsl_version_string}
    in vec4 a_position;
    in vec2 a_texCoord;
    uniform vec2 u_scale;
    out vec2 v_texCoord;
    void main() {
        gl_Position = a_position;
        vec2 adj = vec2(1, -1);
        //gl_Position.xy = (gl_Position.xy + adj)*u_scale.xy - adj;
        gl_Position.xy = (gl_Position.xy + adj)*u_scale.xy - adj;
        v_texCoord = a_texCoord;
    }`
        let program = makeProgramFromCode(gl, vertCode, fragCode);
        let self = {
            program: program,
            quad: createQuadVao(gl, program),
            uniforms: uniformsFromCode(gl, program, vertCode + fragCode),

            uniform(name, ...args) {
                this.uniforms[name].set.apply(this, args);
                return this;
            },

            setuniforms(dict) {
                this.use();
                for (let k in dict) {
                    this.uniforms[k].set.call(this, dict[k]);
                }
                return this;
            },

            use() {
                gl.useProgram(this.program);
                return this;
            },

            draw() {
                this.quad.bind().draw();
                return this;
            },
        };
        self.use();
        self.uniform("u_scale", [1, 1]);
        if (uniforms) self.setuniforms(uniforms);
        return self;
    }

    function makeCube(min=-1, max=1) {
        return {
            vertexComponents: 3,
            vertices: new Float32Array([
                // front
                min, min,  max,
                max, min,  max,
                max,  max,  max,
                min,  max,  max,

                // back
                min, min, min,
                min,  max, min,
                max,  max, min,
                max, min, min,

                // up
                min,  max, min,
                min,  max,  max,
                max,  max,  max,
                max,  max, min,

                // down
                min, min, min,
                max, min, min,
                max, min,  max,
                min, min,  max,

                // right
                max, min, min,
                max,  max, min,
                max,  max,  max,
                max, min,  max,

                // left
                min, min, min,
                min, min,  max,
                min,  max,  max,
                min,  max, min
            ]),
            normals: new Float32Array([
                // front
                0.0,  0.0,  1.0,
                0.0,  0.0,  1.0,
                0.0,  0.0,  1.0,
                0.0,  0.0,  1.0,

                // back
                0.0,  0.0, -1.0,
                0.0,  0.0, -1.0,
                0.0,  0.0, -1.0,
                0.0,  0.0, -1.0,

                // upside
                0.0,  1.0,  0.0,
                0.0,  1.0,  0.0,
                0.0,  1.0,  0.0,
                0.0,  1.0,  0.0,

                // downside
                0.0, -1.0,  0.0,
                0.0, -1.0,  0.0,
                0.0, -1.0,  0.0,
                0.0, -1.0,  0.0,

                // right
                1.0,  0.0,  0.0,
                1.0,  0.0,  0.0,
                1.0,  0.0,  0.0,
                1.0,  0.0,  0.0,

                // left
                -1.0,  0.0,  0.0,
                -1.0,  0.0,  0.0,
                -1.0,  0.0,  0.0,
                -1.0,  0.0,  0.0,
            ]),
            texCoords: new Float32Array([
                // front
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 

                // back
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 

                // upside
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 

                // downside
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 

                // right
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 

                // left
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
            ]),
            indices: new Uint16Array([
                0, 1, 2,
                2, 3, 0,

                4, 5, 6,
                6, 7, 4,

                8, 9, 10,
                10, 11, 8,

                12, 13, 14, 
                14, 15, 12,

                16, 17, 18,
                18, 19, 16,

                20, 21, 22,
                22, 23, 20,
            ]),
        }
    }

    function makeQuad() {
        return {
            vertexComponents: 2,
            vertices: new Float32Array([
                -1, -1,		1, -1,
                1, 1, 		-1, 1,
            ]),
            texCoords: new Float32Array([
                0, 0,		1, 0,
                1, 1, 		0, 1,
            ]),
            indices: new Uint16Array([
                0, 			1, 			2,
                2, 			3, 			0,
            ]),
        }
    }

   
    // make a quad with multiple quad (triangle) sub-components
    function makeQuadWithDivisions(divx=2, divy=2) {
        let vertexComponents = 2;
        let Nx = divx+1;
        let Ny = divy+1;
        let numVertices = vertexComponents * Nx * Ny;
        let numIndices = 6 * divx * divy;
        let geom = {
            vertexComponents: vertexComponents,
            vertices: new Float32Array(numVertices),
            texCoords: new Float32Array(numVertices),
        }

        if (numIndices > 65535) {
            // 6 points to make a quad (from two triangles):
            geom.indices = new Uint32Array(numIndices)
        } else {
            // 6 points to make a quad (from two triangles):
            geom.indices = new Uint16Array(numIndices)
        }

        console.log("expect vertices:", vertexComponents * Nx * Ny, 6 * divx * divy)

        let v = 0, t = 0;
        let dx = 1/divx, dy = 1/divy;
        for (let y=0; y<Ny; y++) {
            for (let x=0; x<Nx; x++) {
                /* 
                vertices
                    [-1, +1], [0, +1], [1, +1], 
                    [-1, +0], [0, +0], [1, +0], 
                    [-1, -1], [0, -1], [1, -1], 
                */
                geom.vertices[v++] = (x*2*dx)-1;    
                geom.vertices[v++] = (y*2*dy)-1;
                geom.texCoords[t++] = x*dx;
                geom.texCoords[t++] = y*dy;
            }
        }

        let i = 0;
        for (let y=0; y<divy; y++) {
            for (let x=0; x<divx; x++) {
                /*
                    Indices:

                    6 7 8
                    3 4 5
                    0 1 2

                    0,1,3, 3,1,4, ...
                    
                    2N...
                    N   N+1 N+2 N+3 ... 2N-1
                    0   1   2   3   ... N-1
                */

                geom.indices[i++] = (y)*Nx + x;
                geom.indices[i++] = (y)*Nx + x+1;
                geom.indices[i++] = (y+1)*Nx + x;
                geom.indices[i++] = (y+1)*Nx + x;
                geom.indices[i++] = (y)*Nx + x+1;
                geom.indices[i++] = (y+1)*Nx + x+1;
            }
        }

        console.log("got vertices:", v, i)

        return geom;
    }

    function makeCube(min=-1, max=1) {
        return {
            vertexComponents: 3,
            vertices: new Float32Array([
                // front
                min, min,  max,
                max, min,  max,
                max,  max,  max,
                min,  max,  max,
    
                // back
                min, min, min,
                min,  max, min,
                max,  max, min,
                max, min, min,
    
                // up
                min,  max, min,
                min,  max,  max,
                max,  max,  max,
                max,  max, min,
    
                // down
                min, min, min,
                max, min, min,
                max, min,  max,
                min, min,  max,
    
                // right
                max, min, min,
                max,  max, min,
                max,  max,  max,
                max, min,  max,
    
                // left
                min, min, min,
                min, min,  max,
                min,  max,  max,
                min,  max, min
            ]),
            normals: new Float32Array([
                // front
                0.0,  0.0,  1.0,
                0.0,  0.0,  1.0,
                0.0,  0.0,  1.0,
                0.0,  0.0,  1.0,
    
                // back
                0.0,  0.0, -1.0,
                0.0,  0.0, -1.0,
                0.0,  0.0, -1.0,
                0.0,  0.0, -1.0,
    
                // upside
                0.0,  1.0,  0.0,
                0.0,  1.0,  0.0,
                0.0,  1.0,  0.0,
                0.0,  1.0,  0.0,
    
                // downside
                0.0, -1.0,  0.0,
                0.0, -1.0,  0.0,
                0.0, -1.0,  0.0,
                0.0, -1.0,  0.0,
    
                // right
                1.0,  0.0,  0.0,
                1.0,  0.0,  0.0,
                1.0,  0.0,  0.0,
                1.0,  0.0,  0.0,
    
                // left
                -1.0,  0.0,  0.0,
                -1.0,  0.0,  0.0,
                -1.0,  0.0,  0.0,
                -1.0,  0.0,  0.0,
            ]),
            texCoords: new Float32Array([
                // front
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
    
                // back
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
    
                // upside
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
    
                // downside
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
    
                // right
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
    
                // left
                0.0,  0.0,  
                1.0,  0.0,
                1.0,  1.0, 
                0.0,  0.1, 
            ]),
            indices: new Uint16Array([
                0, 1, 2,
                2, 3, 0,
    
                4, 5, 6,
                6, 7, 4,
    
                8, 9, 10,
                10, 11, 8,
    
                12, 13, 14, 
                14, 15, 12,
    
                16, 17, 18,
                18, 19, 16,
    
                20, 21, 22,
                22, 23, 20,
            ]),
        }
    }

    function geomFromOBJ(objcode) {
        let lines = objcode.split("\n")
        let vertices = []
        let gvertices = []
        let normals = []
        let gnormals = []
        let texCoords = []
        let gtexCoords = []
        let memo = {}
        let gindices = []
        let indexcount=0;
        for (let line of lines) {
            if (line.substring(0,2) == "vn") {
                let match = line.match(/vn\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)/)
                normals.push([+match[1], +match[2], +match[3]])
            } else if (line.substring(0,2) == "vt") {
                let match = line.match(/vt\s+([0-9.-]+)\s+([0-9.-]+)/)
                texCoords.push([+match[1], +match[2]])
            } else if (line.substring(0,1) == "v") {
                let match = line.match(/v\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)/)
                vertices.push([+match[1], +match[2], +match[3]])
            } else if (line.substring(0,1) == "f") {
                let regex = /([0-9]+)\s*\/\s*([0-9]*)\s*\/\s*([0-9]*)/g
                let face = []
                let match
                while (match = regex.exec(line)) {
                    let name = `${match[1]}/${match[2]}/${match[3]}`
                    let id = memo[name]
                    if (id == undefined) {
                        // a new vertex/normal/texcoord combo, create a new entry for it
                        id = indexcount;
                        let v = vertices[(+match[1])-1]
                        gvertices.push(v[0], v[1], v[2])
                        if (texCoords.length) {
                            let vt = texCoords[(+match[2])-1]
                            gtexCoords.push(vt[0], vt[1])
                        }
                        if (normals.length) {
                            let vn = normals[(+match[3])-1]
                            gnormals.push(vn[0], vn[1], vn[2])
                        }
                        memo[name] = id;
                        indexcount++;
                    }
                    if (face.length >= 3) {
                        // triangle strip
                        //face.push(face[face.length-1], face[face.length-2]);
                        // triangle fan poly
                        face.push(face[face.length-1], face[0]);
                    }
                    face.push(id);
                }
                for (let id of face) {
                    gindices.push(id);
                }
            } else {
                //console.log("ignored", line)
            }
        }
        let geom = {
            vertices: new Float32Array(gvertices)
        }
        if (gnormals.length) geom.normals = new Float32Array(gnormals)
        if (gtexCoords.length) geom.texCoords = new Float32Array(gtexCoords)
        if (gindices.length) geom.indices = new Uint16Array(gindices)
        return geom
    }
        
        //	q must be a normalized quaternion
    function quat_rotate(out, q, v) {
        let p = vec4.fromValues(
        q[3] * v[0] + q[1] * v[2] - q[2] * v[1], // x
        q[3] * v[1] + q[2] * v[0] - q[0] * v[2], // y
        q[3] * v[2] + q[0] * v[1] - q[1] * v[0], // z
        -q[0] * v[0] - q[1] * v[1] - q[2] * v[2] // w
        );
        return vec3.set(
        out,
        p[0] * q[3] - p[3] * q[0] + p[2] * q[1] - p[1] * q[2], // x
        p[1] * q[3] - p[3] * q[1] + p[0] * q[2] - p[2] * q[0], // y
        p[2] * q[3] - p[3] * q[2] + p[1] * q[0] - p[0] * q[1] // z
        );
    }
    
    // equiv. quat_rotate(quat_conj(q), v):
    // q must be a normalized quaternion
    function quat_unrotate(out, q, v) {
        // return quat_mul(quat_mul(quat_conj(q), vec4(v, 0)), q)[0]yz;
        // reduced:
        let p = vec4.fromValues(
        q[3] * v[0] - q[1] * v[2] + q[2] * v[1], // x
        q[3] * v[1] - q[2] * v[0] + q[0] * v[2], // y
        q[3] * v[2] - q[0] * v[1] + q[1] * v[0], // z
        q[0] * v[0] + q[1] * v[1] + q[2] * v[2] // w
        );
        return vec3.set(
        out,
        p[3] * q[0] + p[0] * q[3] + p[1] * q[2] - p[2] * q[1], // x
        p[3] * q[1] + p[1] * q[3] + p[2] * q[0] - p[0] * q[2], // y
        p[3] * q[2] + p[2] * q[3] + p[0] * q[1] - p[1] * q[0] // z
        );
    }
        
    



    if (isCommonjs) {
		module.exports = lib;
	} else {
		window.glutils = lib;
	}

})()