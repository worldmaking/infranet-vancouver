
(function() {
	const isCommonjs = typeof module !== 'undefined' && module.exports;
	const neataptic = isCommonjs ? require("./neataptic.js") : window.neataptic;
	const neataptic_methods = neataptic.methods;
	const Network = neataptic.Network;
	const neataptic_architect = neataptic.architect;
	neataptic.config.warnings = false;
    const utils = isCommonjs ? require("./utils.js") : window.utils;

	let neato = {
		num_inputs: 3,
		num_outputs: 4,
		num_hidden: 0,

		crossover: [
			neataptic_methods.crossover.SINGLE_POINT,
			neataptic_methods.crossover.TWO_POINT,
			neataptic_methods.crossover.UNIFORM,
			neataptic_methods.crossover.AVERAGE
		],

		// https://wagenaartje.github.io/neataptic/docs/methods/mutation/
		numericMutation: [
			neataptic_methods.mutation.MOD_WEIGHT,
			neataptic_methods.mutation.MOD_BIAS,
		],

		structuralMutation: [
			neataptic_methods.mutation.SWAP_NODES,
			neataptic_methods.mutation.MOD_ACTIVATION,
		],

		structuralMutationConstructive: [
			neataptic_methods.mutation.ADD_NODE,
			neataptic_methods.mutation.ADD_CONN,
			neataptic_methods.mutation.ADD_GATE,
			neataptic_methods.mutation.ADD_SELF_CONN,
			neataptic_methods.mutation.ADD_BACK_CONN,
		],

		structuralMutationReductive: [
			neataptic_methods.mutation.SUB_NODE,
			neataptic_methods.mutation.SUB_CONN,
			neataptic_methods.mutation.SUB_GATE,
			neataptic_methods.mutation.SUB_SELF_CONN,
			neataptic_methods.mutation.SUB_BACK_CONN
		],

		structuralMutationAll: this.structuralMutation,

		// defaults:
		equal: true,
		maxNodes: Infinity,
		maxConns: Infinity,
		maxGates: Infinity,

		createNetwork() {
			return new neataptic_architect.Random(
				this.num_inputs,
				this.num_hidden,
				this.num_outputs
			)
		},

		copyNetwork(src) {
			return Network.fromJSON(src.toJSON());
		},


		mutateOnce(genome) {
			let mutationMethod = utils.pick(this.numericMutation);
			genome.mutate(mutationMethod);
		},

		mutateStructuralOnce(genome) {
			// TODO: check overall network size, and prefer reductive than constructive mutations accordingly
			let mutationMethod = utils.pick(this.structuralMutationAll);
			genome.mutate(mutationMethod);
		},
	
	};

	neato.structuralMutationAll = neato.structuralMutation.concat(neato.structuralMutationConstructive, neato.structuralMutationReductive);

	if (isCommonjs) {
		module.exports = neato;
	} else {
		window.neato = neato;
	}

})()
/*
	genome = neato.createGenome();

	for (let c of genome.connections) {
      c.weight = Math.random() - 0.5;
	}
	
	// convert input nodes to use IDENTITY function
    for (let n of genome.nodes) {
      if (n.type == "input") {
        n.squash = methods.activation.IDENTITY;
      }
    }

	neato.mutateOnce(this.genome);

	genome = neato.copyGenome(comrade.genome);

	genome = Network.crossOver(this.genome, comrade.genome, neato.equal);

	if (Math.random() < 0.5) {
		for (let j = 0; j < 5; j++) {
			neato.mutateOnce(genome);
			if (Math.random() <= 0.2) {
				neato.mutateStructuralOnce(genome);
			}
		}
	}

	let outputs = genome.activate(inputs);



*/