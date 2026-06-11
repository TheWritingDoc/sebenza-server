import re

with open('C:/Users/MSI CYBORG/.openclaw/workspace/gshop-app/server/index.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace demo auth with MongoDB auth
content = content.replace('memStorage.users.find(u => u.email === email)', 'await User.findOne({ email })')
content = content.replace('memStorage.users.find(u => u._id === req.userId)', 'await User.findById(req.userId)')
content = content.replace('memStorage.users.find(u => u._id === userId)', 'await User.findById(userId)')

with open('C:/Users/MSI CYBORG/.openclaw/workspace/gshop-app/server/index.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Fixed auth routes to use MongoDB')
