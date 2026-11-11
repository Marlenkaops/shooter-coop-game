export function createGpuTimer(gl) {
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  let query = null, active = false;
  return {
    supported: Boolean(extension),
    begin() {
      if (!extension || query || gl.isContextLost()) return;
      query = gl.createQuery();
      if (!query) return;
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      active = true;
    },
    end() {
      if (!active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      active = false;
    },
    read() {
      if (!query || active || gl.isContextLost()) return null;
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      if (!disjoint && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return null;
      const milliseconds = disjoint ? null : gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
      query = null;
      return milliseconds;
    }
  };
}
