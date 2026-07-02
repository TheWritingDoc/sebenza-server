module.exports = {
  listAccessList: async () => ({ results: [] }),
  addAccessListEntry: async (ip, comment) => ([{ ipAddress: ip, cidrBlock: `${ip}/32`, comment }])
};
