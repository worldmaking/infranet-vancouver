/*

	let space = new SpaceHash({
		width: 1000,
		height: 1000,
		cellSize: 25
	});

	// first creation:
	for (let o of objs) {
		// assumes existince of
		// o.pos[0]
		// o.pos[1]
		space.insertPoint(o);

		// or, larger objects, whose size is > space.cellSize:
		// assumes existence of o.size
		space.insert(o);
	}

	// update:
	for (let o of objs) {
      	o.move();
		space.updatePoint(o);
		
		// or for larger objects:
		space.update(o);
	}
	
	// near is a list of nearest objs to pos = [x, y]
	let near = space.search(pos, radius);

*/

(function() {
	const isCommonjs = typeof module !== 'undefined' && module.exports;

	class SpaceHash {
		
		constructor(opt) {
			this.cellSize = opt.cellSize || 10;
			this.rCellSize = 1 / this.cellSize;
			// round up range to whole number of cells:
			this.numCellsH = Math.ceil((opt.width || 100) / this.cellSize);
			this.numCellsV = Math.ceil((opt.height || 100) / this.cellSize);
			this.width = this.numCellsH * this.cellSize;
			this.height = this.numCellsV * this.cellSize;
			this.maxRadius = Math.min(this.width, this.height) / 2;
			this.numCells = this.numCellsH * this.numCellsV;
			this.clear();

			// create a list of shells
			let shells = [];
			// compute the cell offsets for every cell with respect to a point at the center of the space:
			let cv = Math.floor(this.numCellsV/2);
			let ch = Math.floor(this.numCellsH/2);
			let maxRad2 = this.maxRadius*this.maxRadius;
			for (let v=0; v<this.numCellsV; v++) {
				for (let h=0; h<this.numCellsH; h++) {
					// squared radius of cell from cv,ch, in 'pixels':
					let radius2 = ((v-cv)*(v-cv) + (h-ch)*(h-ch)) * (this.cellSize*this.cellSize); 
					if (radius2 < maxRad2) {
						shells.push({
							// the offset:
							v: v-cv,
							h: h-ch,
							// squared radius of cell from cv,ch, in 'pixels':
							radius2: radius2
						});
					}
				}
			}
			shells.sort((a,b) => a.radius2-b.radius2);
			this.shells = shells;
		}
		
		clear() {
			this.cells = [];
			for (let i = 0; i < this.numCells; i++) this.cells[i] = [];
			return this;
		}
		
		insertPoint(item) {
			const px = item.pos[0], py = item.pos[1];
			const rCellSize = 1 / this.cellSize;
			var h = Math.max(Math.min(~~(px * rCellSize), this.numCellsH - 1), 0);
			var v = Math.max(Math.min(~~(py * rCellSize), this.numCellsV - 1), 0);
			item.__spacehash = { cellH: h, cellV: v };
			this.cells[v * this.numCellsH + h].push(item);
			return this;
		}

		removePoint(item) {
			if (!item.__spacehash) return;
			var v = item.__spacehash.cellV, h = item.__spacehash.cellH;
			var idx = v * this.numCellsH + h;
			var cell = this.cells[idx];
			var k = cell.indexOf(item);
			if (k !== -1) cell.splice(k, 1);
			return this;
		}

		updatePoint(item) {
			// old location
			var ov = item.__spacehash.cellV, oh = item.__spacehash.cellH;
			var oidx = ov * this.numCellsH + oh;
			// new location
			var nx = item.pos[0], ny = item.pos[1];
			var rCellSize = 1/this.cellSize;
			var nh = Math.max(Math.min(~~(nx * rCellSize), this.numCellsH - 1), 0);
			var nv = Math.max(Math.min(~~(ny * rCellSize), this.numCellsV - 1), 0);
			var idx = nv * this.numCellsH + nh;

			if (idx === oidx) return; // no need ot update, we're in the same cell
			// remove from old:
			var cell = this.cells[oidx];
			var k = cell.indexOf(item);
			if (k !== -1) cell.splice(k, 1);
			// update item:
			item.__spacehash.cellH = nh;
			item.__spacehash.cellV = nv;
			// add to new
			this.cells[idx].push(item);
			return this;
		}

		insert(item) {
			const bl = item.pos[0] - item.size;
			const br = item.pos[0] + item.size;
			const bt = item.pos[1] - item.size;
			const bb = item.pos[1] + item.size;
			const rCellSize = 1 / this.cellSize;
			// AABB bounding cells of this item:
			var cellH = Math.max(Math.min(~~(bl * rCellSize), this.numCellsH - 1), 0);
			var cellV = Math.max(Math.min(~~(bt * rCellSize), this.numCellsH - 1), 0);
			var cellH2 = Math.max(Math.min(~~(br * rCellSize), this.numCellsH - 1), 0);
			var cellV2 = Math.max(Math.min(~~(bb * rCellSize), this.numCellsH - 1), 0);
			item.__spacehash = {
				cellH: cellH, cellV: cellV,
				cellV2: cellV2, cellH2: cellH2
			};
			var v, h, idx;
			for (v = cellV; v <= cellV2; v++) {
				for (h = cellH; h <= cellH2; h++) {
					this.cells[v * this.numCellsH + h].push(item);
				}
			}
			return this;
		}

		remove(item) {
			if (!item.__spacehash) return;
			var cellH = item.__spacehash.cellH;
			var cellH2 = item.__spacehash.cellH2;
			var cellV = item.__spacehash.cellV;
			var cellV2 = item.__spacehash.cellV2;
			var v, h, k, idx;
			for (v = cellV; v <= cellV2; v++) {
				for (h = cellH; h <= cellH2; h++) {
					idx = v * this.numCellsH + h;
					k = this.cells[idx].indexOf(item);
					if (k !== -1) this.cells[idx].splice(k, 1);
				}
			}
			return this;
		}

		update(item) { 
			return this.remove(item).insert(item);
		}

		// searches for entries within 'radius' distance of 'pos' = [x, y]
		// returns a list of what it finds
		// list will be only approximately sorted by distance
		// pos = o.pos, the list will include o
		// the number of results is not clamped
		search(pos, dist) {
			const rCellSize = 1 / this.cellSize;
			const ch = (pos[0] * rCellSize);
			const cv = (pos[1] * rCellSize);
			const dist2 = dist * dist;
			var i, v, h, l, n, npos, shell, cell, relx, rely, d2;
			var res = [];
			for (i=0; i<this.shells.length; i++) {
				shell = this.shells[i];
				if (shell.radius2 > dist2) break;
				h = Math.max(Math.min(~~(ch + shell.h), this.numCellsH - 1), 0);
				v = Math.max(Math.min(~~(cv + shell.v), this.numCellsV - 1), 0);
				cell = this.cells[v * this.numCellsH + h];
				l = cell.length;
				for (n = 0; n < l; n++) {
					npos = cell[n].pos;
					relx = npos[0] - pos[0], rely = npos[1] - pos[1];
					d2 = relx * relx + rely * rely;
					if (d2 <= dist2) {
						res.push(cell[n]);
					}
				}
			}
			return res;
		}

		// searches for entries within 'radius' distance of 'self.pos' = [x, y]
		// returns a list of what it finds
		// list will be only approximately sorted by distance
		// pos = o.pos, the list will include o
		searchUnique(self, dist, limit=Infinity, res=[]) {
			const pos = self.pos;
			const rCellSize = 1 / this.cellSize;
			const ch = (pos[0] * rCellSize);
			const cv = (pos[1] * rCellSize);
			const dist2 = dist * dist;
			var i, v, h, l, n, neighbour, npos, shell, cell, relx, rely, d2;
			res.length = 0;
			for (i=0; i<this.shells.length; i++) {
				shell = this.shells[i];
				if (shell.radius2 > dist2) break;
				h = Math.max(Math.min(~~(ch + shell.h), this.numCellsH - 1), 0);
				v = Math.max(Math.min(~~(cv + shell.v), this.numCellsV - 1), 0);
				cell = this.cells[v * this.numCellsH + h];
				l = cell.length;
				for (n = 0; n < l; n++) {
					neighbour = cell[n];
					// skip self:
					if (self == neighbour) continue;
					// need this check, otherwise non-point objects 
					// and objects near borders can appear multiple times
					if (res.indexOf(neighbour) !== -1) continue;
					npos = neighbour.pos;
					relx = npos[0] - pos[0], rely = npos[1] - pos[1];
					d2 = relx * relx + rely * rely;
					if (d2 <= dist2) {
						res.push(neighbour);
						if (res.length == limit) return res;
					}
				}
			}
			return res;
		}

		// searches the AABB box around a point
		searchSimpler(pos, dist) {
			const dist2 = dist * dist;
			// ideal search bounds:
			const bl = pos[0] - dist;
			const br = pos[0] + dist;
			const bt = pos[1] - dist;
			const bb = pos[1] + dist;
			// limited cell search bounds:
			const rCellSize = 1 / this.cellSize;
			const cellH = Math.max(~~(bl * rCellSize), 0);
			const cellH2 = Math.min(~~(br * rCellSize), this.numCellsH - 1);
			const cellV = Math.max(~~(bt * rCellSize), 0);
			const cellV2 = Math.min(~~(bb * rCellSize), this.numCellsV - 1);
			// apparently faster to name variables outside the loops
			let v, h, cell, l, n, npos, relx, rely, d2;
			let res = [];
			// might be able to speed this up by caching the set of cell offests to search for a given radius
			// (which, if arranged as a spiral, could also do a pseudo distance sort for free)
			for (v = cellV; v <= cellV2; v++) {
				for (h = cellH; h <= cellH2; h++) {
					cell = this.cells[v * this.numCellsH + h];
					l = cell.length;
					for (n = 0; n < l; n++) {
						npos = cell[n].pos;
						(relx = npos[0] - pos[0]), (rely = npos[1] - pos[1]);
						d2 = relx * relx + rely * rely;
						if (d2 <= dist2) {
							res.push(cell[n]);
						}
					}
				}
			}
			return res;
		}
	}

	if (isCommonjs) {
		module.exports = SpaceHash;
	} else {
		window.SpaceHash = SpaceHash;
	}

})()