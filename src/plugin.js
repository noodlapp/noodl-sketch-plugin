const sketch = require('sketch');
const fs = require('@skpm/fs');

const { toArray } = require('util');
const {Document, UI} = sketch;

let exportPath;

function exportCSS(layer, options) {
  const css = toArray(layer.sketchObject.CSSAttributes()).map(str => String(str));

  if(options && options.exclude) {
    return css.filter(str => options.exclude.every(excludeProp => str.startsWith(excludeProp) === false));
  }

  return css;
}

function exportResizing(layer) {

  const resizing = {
     pinLeft: layer.sketchObject.hasFixedLeft() ? true : false,
     pinRight: layer.sketchObject.hasFixedRight() ? true : false,
     pinTop: layer.sketchObject.hasFixedTop() ? true : false,
     pinBottom: layer.sketchObject.hasFixedBottom() ? true : false,
     fixedWidth: layer.sketchObject.hasFixedWidth() ? true : false,
     fixedHeight: layer.sketchObject.hasFixedHeight() ? true : false
  };

  if(layer.parent && layer.parent.sketchObject.resizesContent && layer.parent.sketchObject.resizesContent()) {
   
    if(!layer.sketchObject.hasFixedWidth()) { 
      resizing.pinLeft = true;
      resizing.pinRight = true; 
    }

    if(!layer.sketchObject.hasFixedHeight()) {
      resizing.pinTop = true;
      resizing.pinBottom = true;
    }

  }

  return resizing;
}

function exportText(layer) {

  const resizing = exportResizing(layer);

  let sizeMode;
  if(layer.fixedWidth) {
    sizeMode = 'contentHeight';
  }
  else if(resizing.fixedHeight) {
    sizeMode = 'explicit';
  }

  return {
    id: layer.id,
    name: layer.name,
    type: 'Text',
    frame: layer.frame,
    css: exportCSS(layer),
    text: layer.text,
    resizing: exportResizing(layer),
    sizeMode
  }
}

function exportOval(layer) {

  const hasImageFill = (layer.style.fills || []).some(fill => fill.enabled && fill.fillType === 'Pattern' && fill.pattern.image);

  if(hasImageFill) {
    const image = exportImage(layer);
    image.css = exportCSS(layer).concat('border-radius: 100%;');
    return image;
  }  

  return {
    id: layer.id,
    name: layer.name,
    type: 'SVG',
    frame: getFrameWithOffset(layer.frame, getShadowOffset(layer)),
    svg: sketch.export(layer, { formats: 'svg', compact: true, output: false })
  }

  // return {
  //   id: layer.id,
  //   name: layer.name,
  //   type: 'Circle',
  //   frame: layer.frame,
  //   css: exportCSS(layer),
  //   resizing: exportResizing(layer)
  // }
}

function exportRectangle(layer) {

  const hasImageFill = (layer.style.fills || []).some(fill => fill.enabled && fill.fillType === 'Pattern' && fill.pattern.image);

  if(hasImageFill) {
    return exportImage(layer);
  }

  return {
      id: layer.id,
      name: layer.name,
      type: 'Rectangle',
      frame: layer.frame,
      css: exportCSS(layer),
      resizing: exportResizing(layer)
    } 
}

function getShadowOffset(layer) {
  const shadows = layer.style.shadows.filter(s => s.enabled);
  const minX = Math.min(0, ...shadows.map(s => s.x - s.blur - s.spread));
  const minY = Math.min(0, ...shadows.map(s => s.y - s.blur - s.spread));

  return {x: minX,y: minY};
}

function getFrameWithOffset(frame, offset) {
  return {
    x: frame.x + offset.x,
    y: frame.y + offset.y,
    width: frame.width,
    height: frame.height
  }
}

function exportShapePath(layer) {
  switch(layer.shapeType) {
    case 'Rectangle': return exportRectangle(layer);
    case 'Oval': return exportOval(layer);
  }
  
  return {
    id: layer.id,
    name: layer.name,
    type: 'SVG',
    frame: getFrameWithOffset(layer.frame, getShadowOffset(layer)),
    svg: sketch.export(layer, { formats: 'svg', compact: true, output: false })
  }
}

function exportShape(layer) {
  return {
    id: layer.id,
    name: layer.name,
    type: 'SVG',
    frame: getFrameWithOffset(layer.frame, getShadowOffset(layer)),
    svg: sketch.export(layer, { formats: 'svg', compact: true, output: false })
  }
}

function exportGroup(layer) {
  return {
    id: layer.id,
    name: layer.name,
    type: 'Group',
    frame: layer.frame,
    layers: exportLayers(layer.layers),
    resizing: exportResizing(layer)
  }
}

function exportSymbolInstanceOverride(override) {

  if(!override.affectedLayer) return;

  let value = override.value;
  if(override.property === 'image') {
    const imagePath = exportImageAndGetPath(value.sketchObject);
    value = imagePath;
  }

  return {
    name: `${override.affectedLayer.name}-${override.property}`,
    value: value
  }
}

function exportSymbolInstance(layer) {

  const symbolMaster = Document.getSelectedDocument().getSymbolMasterWithID(layer.symbolId);

  const overrides = (layer.overrides || [])
    .filter(l => !l.isDefault)
    .map(o => exportSymbolInstanceOverride(o))
    .filter(o => o !== undefined);

  return {
    id: layer.id,
    type: 'ComponentInstance',
    name: layer.name,
    frame: layer.frame,
    componentId: layer.symbolId,
    componentName: symbolMaster.name,
    css: exportCSS(layer), //to get opacity
    inputValues: overrides,
    resizing: exportResizing(layer)
  }
}

function exportMasterOverride(override) {
  // override.property can be one of the following:
  //  stringValue
  //  symbolID - nested symbol
  //  layerStyle - shared layer style 
  //  textStyle - shared text style 
  //  flowDestination - Hotspot target override
  //  image

  // symbolOverride - boolean:   If the override is a nested symbol override.

  // value 
  // affectedLayer: Text / Image / Symbol Instance
  const targetType = override.affectedLayer.type;

  let targetProperty;
  if(targetType === 'Text' && override.property === 'stringValue') {
    targetProperty = 'text';
  }
  else if((targetType === 'Image' || targetType === 'ShapePath') && override.property === 'image') {
    targetProperty = 'src';  
  }

  if(!targetProperty) {
    return undefined; //override not supported (yet)
  }

  const path = override.path.split('/');
  const targetId = path[0];

  // const targetLayer = Document.getSelectedDocument().getLayerWithID(targetId);
  const inputName = `${override.affectedLayer.name}-${override.property}`;

  return {
    name: inputName,
    targetId: targetId,
    targetProperty: path.length > 1 ? inputName : targetProperty
  }
}

function exportSymbolMaster(layer) {

  // if(layer.sketchObject.resizesContent()) {
    // 
  // }

  const cssOptions = !layer.includeBackgroundColorInInstance ? {exclude:['background-color']} : undefined;

  //symbols can have a background color, so create an extra group
  const frame = {
    x: 0,
    y: 0,
    width: layer.frame.width,
    height: layer.frame.height
  };

  const root = {
    type: 'Group',
    id: layer.id + '-root',
    frame,
    css: exportCSS(layer,  cssOptions),
    layers: exportLayers(layer.layers),
    resizing: {
      fixedWidth: true,
      fixedHeight: true
    }
  };

  return {
    type: 'Component',
    id: layer.id,
    name: layer.name,
    componentId: layer.symbolId,
    frame,
    layers: [root],
    inputs: (layer.overrides || []).map(o => exportMasterOverride(o)).filter(o => o !== undefined)
  };
}

function collectImagesInLayer(layer) {
  const nativeLayer = layer.sketchObject;
  const images = [];

  if(nativeLayer.class() == "MSBitmapLayer") {
      images.push(nativeLayer.image());
  }

  if (nativeLayer.style().enabledFills().count() > 0) {
      const loopFills = nativeLayer.style().enabledFills().objectEnumerator();
      let fill;
      while(fill = loopFills.nextObject()) {
        images.push(fill.image());
      }
  }

  return images;
}

function exportImageAndGetPath(image) {
  
  const imageName = image.sha1().hexString() + '.png';
  const imagePath = exportPath + "/" + imageName;
  image.data().writeToFile_atomically(imagePath, "YES");

  return imageName;
}

function exportImage(layer) {

  const images = collectImagesInLayer(layer);
  const imageName = exportImageAndGetPath(images[0]);

  return {
    id: layer.id,
    name: layer.name,
    type: 'Image',
    frame: layer.frame,
    src: imageName,
    resizing: exportResizing(layer),
    objectFit: 'cover'
  };
}

function exportArtboard(layer) {

  const frame = {
    x: 0,
    y: 0,
    width: layer.frame.width,
    height: layer.frame.height
  };

  const root = {
    type: 'Group',
    id: layer.id + '-root',
    frame,
    css: exportCSS(layer).concat("overflow: hidden;"),
    layers: exportLayers(layer.layers),
    resizing: {
      pinLeft: true,
      pinTop: true,
      fixedWidth: true,
      fixedHeight: true
    }
  };

  return {
    id: layer.id,
    name: layer.name,
    type: 'Component',
    frame,
    layers: [root]
  };
}

function exportLayer(layer) {

  switch(layer.type) {
    case String(sketch.Types.Text): return exportText(layer);
    case String(sketch.Types.ShapePath):  return exportShapePath(layer);
    case String(sketch.Types.Shape): return exportShape(layer);
    case String(sketch.Types.Group): return exportGroup(layer);
    case String(sketch.Types.SymbolInstance): return exportSymbolInstance(layer);
    case String(sketch.Types.SymbolMaster): return exportSymbolMaster(layer);
    case String(sketch.Types.Image): return exportImage(layer);
    case String(sketch.Types.Artboard): return exportArtboard(layer);
  }

  console.log('unknown layer type', layer);
  return {type: 'unknown'};
}

function exportLayers(layers) {
  return layers ? layers.map(layer => exportLayer(layer)) : undefined;
}

function collectSymbols(layer, symbolMasters) {
  if(layer.type === String(sketch.Types.SymbolInstance)) {
    const symbolMaster = Document.getSelectedDocument().getSymbolMasterWithID(layer.symbolId);
    if(!symbolMasters[layer.symbolId]) {
      symbolMasters[layer.symbolId] = exportLayer(symbolMaster);
      symbolMaster.layers && symbolMaster.layers.forEach(child => collectSymbols(child, symbolMasters));
    }
  }

  layer.layers && layer.layers.forEach(child => collectSymbols(child, symbolMasters));
}

function sendToNoodl(exportData) {
  fs.writeFileSync(`${exportPath}/export.json`, JSON.stringify(exportData));
  NSWorkspace.sharedWorkspace().openURL(NSURL.URLWithString(`noodl:externaltoolimport/file://${exportPath}`));
}

function setZeroOrigin(layersExport) {
  const x = -Math.min(...layersExport.map(l => l.frame.x));
  const y = -Math.min(...layersExport.map(l => l.frame.y));

  layersExport.forEach(l => {
    l.frame = getFrameWithOffset(l.frame, {x, y});
  });
}

export default function onRun(context) {

  UI.message(`Exporting to Noodl...`);

  exportPath = fs.mkdtempSync(NSTemporaryDirectory() + "noodl-export");

  const document = sketch.fromNative(context.document);

  //get the selected layers
  const selectedLayers = document.selectedLayers.layers;

  //export them in a component with the same name as the selected page
  const selectedPage = document.selectedPage;

  //gather data for all layers in the selected page...
  const selectedLayersExport = selectedLayers.map(exportLayer);
  
  //...and for all symbols that the layers refer to (if any)
  const symbolMasters = {};
  selectedLayers.forEach(layer => collectSymbols(layer, symbolMasters));

  //and export the symbols as components
  const artboards = selectedLayersExport.filter(l => l.type === 'Component');
  const otherLayers = selectedLayersExport.filter(l => l.type !== 'Component');

  const components = Object.values(symbolMasters).concat(artboards);

  //set origin to 0,0
  setZeroOrigin(otherLayers);

  const pages = otherLayers.length ? [
    {
      name: selectedPage.name,
      id: selectedPage.name,
      layers: selectedLayersExport
    }
  ] : undefined;

  const exportData = {
    type: 'noodl-external-tool-export',
    version: '1',
    sourceDocument: {
      id: document.id,
      path: document.path
    },
    sourceTool: { 
      name: 'sketch',
      version: String(sketch.version.sketch)
    },
    components,
    pages
  };

  sendToNoodl(exportData);
} 
