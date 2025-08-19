require('dotenv').config() // Load .env file
const axios = require('axios')
const { Client, GatewayIntentBits, ActivityType } = require('discord.js')

const client = new Client({ 
	intents: [GatewayIntentBits.Guilds] 
})

// Track last channel update to avoid rate limits
let lastChannelUpdate = 0

async function pingForPlayers() {
	try {
		// Try mcapi.us first (less caching), fallback to mcsrvstat.us
		let res;
		try {
			res = await axios.get(`https://mcapi.us/server/status?ip=${process.env.MC_SERVER_IP}`, { timeout: 5000 })
			console.log('📡 MCAPI Response:', JSON.stringify(res.data, null, 2))
			
			// Transform mcapi.us response to match mcsrvstat format
			if (res.data.online) {
				const originalData = res.data
				res.data = {
					online: true,
					players: {
						online: originalData.players ? originalData.players.now : 0,
						max: originalData.players ? originalData.players.max : 0,
						list: originalData.players && originalData.players.sample ? originalData.players.sample.map(p => p.name) : []
					},
					version: originalData.server ? originalData.server.name : 'Unknown'
				}
			} else {
				res.data = { online: false }
			}
		} catch (mcapiErr) {
			console.log('⚠️ MCAPI failed, trying mcsrvstat.us...')
			res = await axios.get(`https://api.mcsrvstat.us/2/${process.env.MC_SERVER_IP}?t=${Date.now()}`)
			console.log('📡 MCSrvStat Response:', JSON.stringify(res.data, null, 2))
		}
		
		// If we got a valid response
		if(res.data && res.data.players) {
			let playerCount = res.data.players.online || 0
			let maxPlayers = res.data.players.max || 0
			let serverVersion = res.data.version || 'Unknown'
			let playerList = res.data.players.list || []
			
			// Create activity text with more info
			let activityText = `${playerCount}/${maxPlayers} players`
			
			// Add first few player names if available
			if (playerList.length > 0) {
				let displayNames = playerList.slice(0, 3).join(', ')
				if (playerList.length > 3) {
					displayNames += ` +${playerList.length - 3} more`
				}
				activityText = `${playerCount}/${maxPlayers}: ${displayNames}`
			}
			
			client.user.setActivity(activityText, {
				type: ActivityType.Watching
			})
			
			// Update voice channel name if configured (with rate limit protection)
			if (process.env.VOICE_CHANNEL_ID) {
				try {
					const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
					if (voiceChannel) {
						const channelName = `🎮 Players: ${playerCount}/${maxPlayers}`
						const now = Date.now()
						
						if (voiceChannel.name !== channelName) {
							const cooldownMs = Math.max(10, process.env.MC_PING_FREQUENCY || 10) * 60 * 1000 // Min 10 minutes
							if (now - lastChannelUpdate >= cooldownMs) {
								await voiceChannel.setName(channelName)
								lastChannelUpdate = now
								console.log(`✅ Updated voice channel: ${channelName}`)
							} else {
								const timeLeft = Math.ceil((cooldownMs - (now - lastChannelUpdate)) / 60000)
								console.log(`🕒 Rate limited, next update in ${timeLeft} minutes`)
							}
						} else {
							console.log(`⏭️ Channel name already correct: ${channelName}`)
						}
					} else {
						console.log(`❌ Voice channel not found with ID: ${process.env.VOICE_CHANNEL_ID}`)
					}
				} catch (voiceErr) {
					console.log('❌ Error updating voice channel:', voiceErr.message)
				}
			}
			
			console.log(`Updated: ${playerCount}/${maxPlayers} players${playerList.length > 0 ? ` (${playerList.join(', ')})` : ''}`)
		} else {
			client.user.setActivity('Server offline', {
				type: ActivityType.Watching
			})
			
			// Update voice channel for offline server
			if (process.env.VOICE_CHANNEL_ID) {
				try {
					const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
					if (voiceChannel) {
						const channelName = '🔴 Server Offline'
						if (voiceChannel.name !== channelName) {
							await voiceChannel.setName(channelName)
						}
					}
				} catch (voiceErr) {
					console.log('Error updating voice channel:', voiceErr.message)
				}
			}
			
			console.log('Server appears to be offline or unreachable')
		}
	} catch (err) {
		client.user.setActivity('Connection error', {
			type: ActivityType.Watching
		})
		
		// Update voice channel for connection error
		if (process.env.VOICE_CHANNEL_ID) {
			try {
				const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
				if (voiceChannel) {
					const channelName = '❌ Connection Error'
					if (voiceChannel.name !== channelName) {
						await voiceChannel.setName(channelName)
					}
				}
			} catch (voiceErr) {
				console.log('Error updating voice channel:', voiceErr.message)
			}
		}
		
		console.log('Error pinging api.mcsrvstat.us for data:', err.message)
	}
}

// Runs when client connects to Discord.
client.once('ready', () => {
	console.log('Logged in as', client.user.tag)

	pingForPlayers() // Ping server once on startup
	// Ping the server and set the new status message every x minutes. (Minimum of 1 minute)
	setInterval(pingForPlayers, Math.max(1, process.env.MC_PING_FREQUENCY || 1) * 60 * 1000)
})

// Graceful shutdown handler
async function gracefulShutdown(signal) {
	console.log(`\n🛑 Received ${signal}, shutting down gracefully...`)
	
	// Update voice channel to show bot is offline
	if (process.env.VOICE_CHANNEL_ID && client.isReady()) {
		try {
			const voiceChannel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID)
			if (voiceChannel) {
				await voiceChannel.setName('🔴 Bot Offline')
				console.log('✅ Updated voice channel to show bot offline')
			}
		} catch (err) {
			console.log('❌ Error updating voice channel on shutdown:', err.message)
		}
	}
	
	// Gracefully close Discord connection
	if (client.isReady()) {
		await client.destroy()
		console.log('✅ Discord connection closed')
	}
	
	console.log('👋 Bot shutdown complete')
	process.exit(0)
}

// Handle different shutdown signals
process.on('SIGINT', async () => {
	console.log('\n⚠️ Received SIGINT (Ctrl+C)')
	await gracefulShutdown('SIGINT')
})
process.on('SIGTERM', async () => {
	console.log('\n⚠️ Received SIGTERM')
	await gracefulShutdown('SIGTERM')
})

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
	console.error('💥 Uncaught Exception:', err)
	await gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', async (reason, promise) => {
	console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason)
	await gracefulShutdown('unhandledRejection')
})

// Login to Discord
client.login(process.env.DISCORD_TOKEN)
