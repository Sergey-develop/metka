# Builds a tiny deterministic ONNX "embedding model" used only to test the
# ONNX adapter end-to-end: input [1,3,8,8] -> per-channel mean -> MatMul(3x4).
import sys
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

w = np.array([[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]], dtype=np.float32)
axes = numpy_helper.from_array(np.array([2, 3], dtype=np.int64), name="axes")
nodes = [
    helper.make_node("ReduceMean", ["input", "axes"], ["pooled"], keepdims=0),
    helper.make_node("MatMul", ["pooled", "W"], ["embedding"]),
]
graph = helper.make_graph(
    nodes, "tiny_embedding",
    [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, 8, 8])],
    [helper.make_tensor_value_info("embedding", TensorProto.FLOAT, [1, 4])],
    initializer=[numpy_helper.from_array(w, name="W"), axes],
)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)], ir_version=9)
onnx.checker.check_model(model)
onnx.save(model, sys.argv[1])
